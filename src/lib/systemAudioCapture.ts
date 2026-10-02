/**
 * systemAudioCapture.ts — V2 Universal System Audio Capture Pipeline
 *
 * 1. Universal Loopback  : desktopCapturer(Electron) 또는 getDisplayMedia(browser) — 기존 captureSystemAudio()와 연동
 * 2. Silero VAD          : @ricky0123/vad-web (WebAssembly, Silero 신경망 모델)로 정확한 발화 구간 감지
 *                          → 초기화 실패 시 RMS 기반 폴백 자동 적용
 * 3. AEC Gate            : muteUntilRef(sysMuteUntilRef) 기반 소프트웨어 에코 캔슬링
 *                          → TTS 재생 중/직후 sys 오디오 무시 → Howling(무한 에코) 차단
 * 4. PCM Normalization   : Float32(16kHz) → Int16 PCM → Base64
 *                          → Gemini Live API inline_data { mime_type: "audio/pcm;rate=16000" } 포맷 준수
 */

import type { MutableRefObject } from 'react';
import { createRmsVadEngine } from './rmsVadEngine';

// ── CDN 에셋 경로 (로컬 app:// 서빙 에러 우회) ───────────────────────────
// Electron app:// 프로토콜에서 WASM Module Worker 로드 실패 → JSDelivr CDN으로 대체
const VAD_BASE_PATH = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';
const ONNX_WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

/** Gemini Live API에 전달할 음성 청크 */
export type PcmChunk = {
  /** 발화 종료 시각 (Date.now()) */
  timestamp: number;
  /** 16kHz Float32 PCM 샘플 */
  pcm: Float32Array;
  /** base64(Int16 LE PCM) — Gemini Live API inline_data.data 필드에 직접 사용 */
  base64: string;
  /** 발화 길이 (ms) */
  durationMs: number;
};

export type VADCallbacks = {
  onSpeechStart?: () => void;
  onSpeechEnd: (chunk: PcmChunk) => void;
  /**
   * 발화 중 실시간 오디오 스트리밍 콜백 (저지연 모드)
   * 설정 시: 말하는 도중 100ms 단위로 base64 PCM을 전달 → Gemini가 즉시 번역 시작
   * 설정 시 onSpeechEnd에서는 오디오를 재전송하지 않음 (중복 방지)
   */
  onSpeechFrame?: (base64: string) => void;
  /** Silero VAD 초기화 실패 시 호출 (RMS 폴백으로 계속 동작) */
  onVADFallback?: (reason: string) => void;
};

export type VADOptions = {
  /** TTS 재생 중에는 sys 오디오 무시 (AEC 게이트) */
  muteUntilRef?: MutableRefObject<number>;
  /**
   * speech: Silero 발화 구간 안에서만 frame 전송.
   * continuous: 캡처 소스 RMS가 있는 동안 frame을 계속 전송.
   * Browser Tab Translate처럼 이미 분리된 소스는 continuous가 더 안정적입니다.
   */
  streamMode?: 'speech' | 'continuous';
  /** 2차 RMS 에너지 게이트. 기본: 0.005 (숨소리 필터) */
  minRms?: number;
  /**
   * 침묵 감지 후 발화 종료까지 대기 시간 (ms). 기본: 700ms
   * 통번역 UX: 절 간 포즈(450ms) 초과 보장 → 문장 중간 끊김 방지
   */
  redemptionMs?: number;
  /**
   * 발화 종료 민감도 (0~1). 기본: 0.35
   * 히스테리시스 갭 = 0.50 - 0.35 = 0.15p → 문장 내 짧은 포즈에서 오검출 방지
   */
  negativeSpeechThreshold?: number;
  /**
   * 최소 발화 인정 시간 (ms). 기본: 300ms
   * 기침(100~280ms) 95% 차단, 단음절 어절 보존
   */
  minSpeechMs?: number;
  /**
   * RMS 폴백 침묵 판단 시간 (ms). 기본: redemptionMs + 200ms
   * 핵심 공식: rmsTimeoutMs > redemptionMs → Silero가 항상 먼저 실행됨
   * (RMS 폴백 전용 — Silero 경로는 redemptionMs 사용)
   */
  rmsTimeoutMs?: number;
  /**
   * 무한 발화 방지 하드 캡 (ms). 기본: 15000ms
   * 이 시간 초과 시 강제 EoT → Gemini 응답 보장
   * (RMS 폴백 전용)
   */
  maxSpeechMs?: number;
};

// ── 통번역 최적화 VAD 프리셋 ─────────────────────────────────────────────────
// rmsTimeoutMs = redemptionMs + 200ms (동적 공식)
// ∴ Silero 정상 시 T_silero < T_rms → Silero가 항상 먼저 EoT 실행
// ∴ Silero 실패 시 T_rms = redemptionMs + 200ms (프리셋 의도 유지)
const FALLBACK_BUFFER_MS = 200;
export type VADPreset = 'fast' | 'balanced' | 'accurate';
export const VAD_TRANSLATION_PRESETS: Record<VADPreset, Required<Omit<VADOptions, 'muteUntilRef' | 'streamMode'>>> = {
  /**
   * 빠름: 짧은 문장, 즉각 반응
   * L_total ≈ 500 + 700ms = 1200ms ✓
   */
  fast: {
    redemptionMs: 500,
    negativeSpeechThreshold: 0.42,
    minSpeechMs: 260,
    minRms: 0.006,
    rmsTimeoutMs: 500 + FALLBACK_BUFFER_MS, // 700ms
    maxSpeechMs: 12000,
  },
  /**
   * 보통: 통번역 UX 최적 균형 (권장)
   * L_total ≈ 700 + 700ms = 1400ms ✓
   */
  balanced: {
    redemptionMs: 700,
    negativeSpeechThreshold: 0.35,
    minSpeechMs: 300,
    minRms: 0.005,
    rmsTimeoutMs: 700 + FALLBACK_BUFFER_MS, // 900ms
    maxSpeechMs: 15000,
  },
  /**
   * 정확: 생각하는 포즈가 있는 화자
   * L_total ≈ 1000 + 700ms = 1700ms ✓
   */
  accurate: {
    redemptionMs: 1000,
    negativeSpeechThreshold: 0.28,
    minSpeechMs: 400,
    minRms: 0.004,
    rmsTimeoutMs: 1000 + FALLBACK_BUFFER_MS, // 1200ms
    maxSpeechMs: 20000,
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// PCM 변환 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Float32 PCM [-1, 1] → Int16 LE PCM → Base64
 * Gemini Live API: inline_data { mime_type: "audio/pcm;rate=16000", data: base64 }
 */
function float32ToBase64Pcm(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Float32Array → PcmChunk (타임스탬프 포함) */
function toPcmChunk(audio: Float32Array): PcmChunk {
  return {
    timestamp: Date.now(),
    pcm: audio,
    base64: float32ToBase64Pcm(audio),
    durationMs: Math.round((audio.length / 16000) * 1000),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Silero VAD 연결 (WebAssembly, @ricky0123/vad-web)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기존 MediaStream에 Silero VAD를 붙여 발화 구간을 감지합니다.
 * 초기화 실패 시 RMS 기반 폴백으로 자동 전환됩니다.
 *
 * @returns cleanup 함수 (VAD 중지 + 리소스 해제)
 */
export async function attachVAD(
  stream: MediaStream,
  callbacks: VADCallbacks,
  options: VADOptions = {}
): Promise<() => void> {
  const {
    muteUntilRef,
    streamMode = 'speech',
    minRms = 0.005,
    redemptionMs = 700,
    negativeSpeechThreshold = 0.35,
    minSpeechMs = 300,
    // RMS 폴백 전용 (Silero 경로는 redemptionMs/minSpeechMs 사용)
    rmsTimeoutMs = redemptionMs + FALLBACK_BUFFER_MS,
    maxSpeechMs = 15000,
  } = options;
  const isMuted = () => muteUntilRef != null && Date.now() < muteUntilRef.current;
  const shouldStreamContinuously = streamMode === 'continuous';

  let vadCtx: AudioContext | null = null;
  try {
    const { MicVAD } = await import('@ricky0123/vad-web');

    // AudioContext를 외부에서 생성하여 주입 → start() 후 강제 resume 가능
    vadCtx = new AudioContext();
    const ownCtx = vadCtx;

    // ── 실시간 스트리밍: 100ms(1600샘플 @ 16kHz) 단위로 전송 ──────
    const STREAM_CHUNK_SAMPLES = 1600; // 16000Hz × 0.1s
    let isSpeakingVAD = false;
    let streamFrameBuffer: Float32Array[] = [];
    let streamFrameSamples = 0;

    const flushStreamBuffer = () => {
      if (streamFrameBuffer.length === 0 || !callbacks.onSpeechFrame || isMuted()) return;
      const combined = new Float32Array(streamFrameSamples);
      let off = 0;
      for (const f of streamFrameBuffer) { combined.set(f, off); off += f.length; }
      streamFrameBuffer = [];
      streamFrameSamples = 0;
      callbacks.onSpeechFrame(float32ToBase64Pcm(combined));
    };

    const vad = await MicVAD.new({
      // 기존 캡처된 스트림을 사용 (mic 새 캡처 X)
      audioContext: ownCtx,
      getStream: async () => stream,
      pauseStream: async () => {},
      resumeStream: async (s) => s,

      // 로컬 정적 에셋 (CDN 없이 동작, Electron 오프라인 환경 대응)
      baseAssetPath: VAD_BASE_PATH,
      onnxWASMBasePath: ONNX_WASM_BASE_PATH,

      // Silero legacy 모델 (더 가벼움, 16kHz 최적화)
      model: 'legacy',
      startOnLoad: false,

      // ── 응답 속도 (VADOptions에서 주입) ─────────────────────────
      redemptionMs,
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold,
      minSpeechMs,

      // ── Electron app:// 프로토콜 호환 설정 ──────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ortConfig: (ort: any) => {
        if (typeof ort?.env?.wasm === 'object') {
          ort.env.wasm.wasmPaths = ONNX_WASM_BASE_PATH;
        }
      },

      onSpeechStart: () => {
        isSpeakingVAD = true;
        streamFrameBuffer = [];
        streamFrameSamples = 0;
        if (!isMuted()) callbacks.onSpeechStart?.();
      },
      onSpeechEnd: (audio: Float32Array) => {
        isSpeakingVAD = false;
        // onSpeechFrame 스트리밍 모드: 잔여 버퍼 flush 후 종료 신호만 전달
        if (callbacks.onSpeechFrame) {
          flushStreamBuffer();
          if (!isMuted()) callbacks.onSpeechEnd(toPcmChunk(new Float32Array(0)));
          return;
        }
        // 기존 batch 모드: 전체 청크를 한 번에 전송
        if (isMuted()) return;
        const rms = Math.sqrt(audio.reduce((s, v) => s + v * v, 0) / audio.length);
        if (rms < minRms) return;
        callbacks.onSpeechEnd(toPcmChunk(audio));
      },
      onVADMisfire: () => {
        isSpeakingVAD = false;
        streamFrameBuffer = [];
        streamFrameSamples = 0;
      },
      // 발화 중 프레임별 오디오 수신 → 100ms 단위로 누적 후 전송
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onFrameProcessed: (probs: any, frameAudio?: Float32Array) => {
        if (isMuted() || !callbacks.onSpeechFrame || !frameAudio) return;

        if (shouldStreamContinuously) {
          const rms = Math.sqrt(frameAudio.reduce((s, v) => s + v * v, 0) / frameAudio.length);
          if (rms < minRms) {
            flushStreamBuffer();
            if (isSpeakingVAD) callbacks.onSpeechEnd(toPcmChunk(new Float32Array(0)));
            isSpeakingVAD = false;
            return;
          }
          if (!isSpeakingVAD) {
            isSpeakingVAD = true;
            callbacks.onSpeechStart?.();
          }
        } else if (!isSpeakingVAD) {
          return;
        }

        streamFrameBuffer.push(frameAudio.slice(0));
        streamFrameSamples += frameAudio.length;
        if (streamFrameSamples >= STREAM_CHUNK_SAMPLES) {
          flushStreamBuffer();
        }
      },
      onSpeechRealStart: () => {},
    });

    await vad.start();

    // ── AudioContext 강제 resume ──────────────────────────────────────────
    // 브라우저/Electron 자동재생 방지 정책으로 suspended 상태로 시작될 수 있음
    if (ownCtx.state === 'suspended') {
      await ownCtx.resume();
      console.log('[VAD] AudioContext 강제 resume ✓');
    }
    console.log('[VAD] Silero VAD 초기화 성공 ✓ (AudioContext state:', ownCtx.state, ')');

    return async () => {
      try { await vad.destroy(); } catch { /* 이미 종료됨 */ }
      try { await ownCtx.close(); } catch { /* 이미 종료됨 */ }
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[VAD] Silero 초기화 실패 → RMS 폴백:', reason);
    // Silero 초기화 중 생성된 AudioContext 누수 방지
    vadCtx?.close().catch(() => {});
    callbacks.onVADFallback?.(reason);
    return attachRmsVAD(stream, callbacks, {
      muteUntilRef,
      streamMode,
      minRms,
      rmsTimeoutMs,
      minSpeechMs,
      maxSpeechMs,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RMS 기반 폴백 VAD
// ─────────────────────────────────────────────────────────────────────────────

/** RMS 폴백 오디오 블록 크기 (샘플) — 16kHz 기준 64ms */
const RMS_BLOCK_SAMPLES = 1024;

/**
 * WebAssembly 없이 동작하는 RMS 기반 VAD 폴백.
 *
 * ScriptProcessorNode(오디오 스레드)가 겹치지 않는 연속 PCM 블록을 전달 → 각 샘플은 한 번만 전송.
 * requestAnimationFrame/타이머를 쓰지 않으므로 창 최소화/백그라운드에서도 멈추지 않는다.
 * (ScriptProcessorNode는 deprecated지만 Chromium/Electron에서 안정적으로 동작하고,
 *  app:// + COOP/COEP 환경에서 AudioWorklet 모듈 로드 리스크가 없다.)
 *
 * - batch(onSpeechFrame 없음): rmsTimeoutMs 침묵 후 발화 구간 PCM을 onSpeechEnd로 전달
 * - streaming(onSpeechFrame 있음): 100ms 단위 onSpeechFrame + 빈 onSpeechEnd (Silero 경로와 동일한 계약)
 * - streamMode 'continuous': RMS ≥ minRms 블록을 계속 스트리밍 (Browser Tab Rx)
 */
function attachRmsVAD(
  stream: MediaStream,
  callbacks: VADCallbacks,
  options: {
    muteUntilRef?: MutableRefObject<number>;
    streamMode?: 'speech' | 'continuous';
    minRms?: number;
    rmsTimeoutMs?: number;   // 침묵 판단 시간 (프리셋: redemptionMs + 200ms)
    minSpeechMs?: number;    // 최소 발화 인정 시간
    maxSpeechMs?: number;    // 무한 발화 하드 캡
  } = {}
): () => void {
  const {
    muteUntilRef,
    streamMode = 'speech',
    minRms = 0.01,
    rmsTimeoutMs = 900,   // balanced 기본: 700+200
    minSpeechMs = 300,
    maxSpeechMs = 15000,
  } = options;
  const isMuted = () => muteUntilRef != null && Date.now() < muteUntilRef.current;

  const SAMPLE_RATE = 16000;

  const engine = createRmsVadEngine(
    {
      sampleRate: SAMPLE_RATE,
      minRms,
      rmsTimeoutMs,
      minSpeechMs,
      maxSpeechMs,
      streamMode,
      streaming: Boolean(callbacks.onSpeechFrame),
      chunkSamples: SAMPLE_RATE / 10, // 100ms — Silero 경로 STREAM_CHUNK_SAMPLES와 동일
    },
    {
      onSpeechStart: () => callbacks.onSpeechStart?.(),
      onSpeechEnd: (audio) => callbacks.onSpeechEnd(toPcmChunk(audio)),
      onSpeechFrame: (pcm) => callbacks.onSpeechFrame?.(float32ToBase64Pcm(pcm)),
    }
  );

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const src = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(RMS_BLOCK_SAMPLES, 1, 1);
  // ScriptProcessor는 destination에 연결돼야 onaudioprocess가 호출된다.
  // 출력은 gain 0으로 무음 처리 (어떤 출력 장치로도 소리가 나가지 않음).
  const silentSink = ctx.createGain();
  silentSink.gain.value = 0;

  let stopped = false;
  processor.onaudioprocess = (ev) => {
    if (stopped) return;
    engine.process(ev.inputBuffer.getChannelData(0), isMuted());
  };

  src.connect(processor);
  processor.connect(silentSink);
  silentSink.connect(ctx.destination);

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  console.log('[VAD] RMS 폴백 VAD 시작 (streamMode:', streamMode, ')');

  return () => {
    stopped = true;
    processor.onaudioprocess = null;
    engine.reset();
    try { src.disconnect(); } catch { /* 이미 해제됨 */ }
    try { processor.disconnect(); } catch { /* 이미 해제됨 */ }
    try { silentSink.disconnect(); } catch { /* 이미 해제됨 */ }
    ctx.close().catch(() => {});
  };
}
