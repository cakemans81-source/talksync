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
  /** Silero VAD 초기화 실패 시 호출 (RMS 폴백으로 계속 동작) */
  onVADFallback?: (reason: string) => void;
};

export type VADOptions = {
  /**
   * TTS 재생 중에는 sys 오디오 무시 (AEC 게이트)
   * Date.now() < muteUntilRef.current 이면 onSpeechEnd 콜백 억제
   */
  muteUntilRef?: MutableRefObject<number>;
  /**
   * 추가 RMS 임계값 필터 (VAD 통과 후 2차 에너지 게이트)
   * 기본: 0.004 (매우 조용한 잡음 필터링)
   */
  minRms?: number;
  /**
   * 침묵 감지 후 발화 종료까지 대기 시간 (ms)
   * 낮을수록 빠르게 반응, 높을수록 말 중간 끊김 방지
   * 기본: 400ms (라이브러리 기본값 1400ms 대비 최적화)
   */
  redemptionMs?: number;
  /** 발화 종료 민감도 (0~1, 높을수록 빠름). 기본: 0.45 */
  negativeSpeechThreshold?: number;
  /** 최소 발화 인정 시간 (ms). 기본: 150ms */
  minSpeechMs?: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// PCM 변환 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Float32 PCM [-1, 1] → Int16 LE PCM → Base64
 * Gemini Live API: inline_data { mime_type: "audio/pcm;rate=16000", data: base64 }
 */
export function float32ToBase64Pcm(float32: Float32Array): string {
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
    minRms = 0.004,
    redemptionMs = 400,
    negativeSpeechThreshold = 0.45,
    minSpeechMs = 150,
  } = options;
  const isMuted = () => muteUntilRef != null && Date.now() < muteUntilRef.current;

  try {
    const { MicVAD } = await import('@ricky0123/vad-web');

    // AudioContext를 외부에서 생성하여 주입 → start() 후 강제 resume 가능
    const vadCtx = new AudioContext();

    const vad = await MicVAD.new({
      // 기존 캡처된 스트림을 사용 (mic 새 캡처 X)
      audioContext: vadCtx,
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
      // COOP/COEP로 crossOriginIsolated가 활성화되면 threaded WASM이 정상 동작.
      // 혹시 SharedArrayBuffer가 없는 환경이라면 wasmPaths를 명시하여
      // 경로 해석 오류를 방지하고, 에러 시 RMS 폴백으로 낙하산 착지.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ortConfig: (ort: any) => {
        if (typeof ort?.env?.wasm === 'object') {
          // WASM 파일 위치를 절대 경로로 고정 (Electron pathname 해석 불일치 방지)
          ort.env.wasm.wasmPaths = ONNX_WASM_BASE_PATH;
        }
      },

      onSpeechStart: () => {
        if (!isMuted()) callbacks.onSpeechStart?.();
      },
      onSpeechEnd: (audio: Float32Array) => {
        if (isMuted()) return;

        // 2차 RMS 게이트: VAD를 통과했지만 에너지가 너무 낮은 잡음 필터링
        const rms = Math.sqrt(audio.reduce((s, v) => s + v * v, 0) / audio.length);
        if (rms < minRms) return;

        callbacks.onSpeechEnd(toPcmChunk(audio));
      },
      onVADMisfire: () => {},
      onFrameProcessed: () => {},
      onSpeechRealStart: () => {},
    });

    await vad.start();

    // ── AudioContext 강제 resume ──────────────────────────────────────────
    // 브라우저/Electron 자동재생 방지 정책으로 suspended 상태로 시작될 수 있음
    if (vadCtx.state === 'suspended') {
      await vadCtx.resume();
      console.log('[VAD] AudioContext 강제 resume ✓');
    }
    console.log('[VAD] Silero VAD 초기화 성공 ✓ (AudioContext state:', vadCtx.state, ')');

    return async () => {
      try { await vad.destroy(); } catch { /* 이미 종료됨 */ }
      try { await vadCtx.close(); } catch { /* 이미 종료됨 */ }
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[VAD] Silero 초기화 실패 → RMS 폴백:', reason);
    callbacks.onVADFallback?.(reason);
    return attachRmsVAD(stream, callbacks, { muteUntilRef, minRms });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RMS 기반 폴백 VAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebAssembly 없이 동작하는 RMS 기반 VAD 폴백.
 * 침묵 1초 후 발화 종료로 판단, 발화 구간 PCM을 합산하여 PcmChunk로 반환.
 */
function attachRmsVAD(
  stream: MediaStream,
  callbacks: VADCallbacks,
  options: { muteUntilRef?: MutableRefObject<number>; minRms?: number } = {}
): () => void {
  const { muteUntilRef, minRms = 0.01 } = options;
  const isMuted = () => muteUntilRef != null && Date.now() < muteUntilRef.current;

  const SAMPLE_RATE = 16000;
  const SILENCE_MS = 500;

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);
  let silenceStart: number | null = null;
  let isSpeaking = false;
  let speechBuffer: Float32Array[] = [];
  let rafId: number;

  const check = () => {
    analyser.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    const now = Date.now();

    if (isMuted()) {
      // AEC 게이트 활성화 — 버퍼 초기화
      silenceStart = null;
      isSpeaking = false;
      speechBuffer = [];
      rafId = requestAnimationFrame(check);
      return;
    }

    if (rms >= minRms) {
      if (!isSpeaking) {
        isSpeaking = true;
        callbacks.onSpeechStart?.();
      }
      silenceStart = null;
      speechBuffer.push(buf.slice(0));
    } else if (isSpeaking) {
      if (silenceStart === null) {
        silenceStart = now;
      } else if (now - silenceStart >= SILENCE_MS) {
        isSpeaking = false;

        // 발화 구간 PCM 합산
        const total = speechBuffer.reduce((s, b) => s + b.length, 0);
        const combined = new Float32Array(total);
        let offset = 0;
        for (const b of speechBuffer) { combined.set(b, offset); offset += b.length; }
        speechBuffer = [];
        silenceStart = null;

        callbacks.onSpeechEnd(toPcmChunk(combined));
      }
    }

    rafId = requestAnimationFrame(check);
  };

  rafId = requestAnimationFrame(check);
  console.log('[VAD] RMS 폴백 VAD 시작');

  return () => {
    cancelAnimationFrame(rafId);
    src.disconnect();
    ctx.close();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PcmChunk 버퍼 (Gemini Live API 전송용 슬라이딩 윈도우)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 수신된 PcmChunk를 FIFO 버퍼에 쌓고 maxLength 초과 시 오래된 항목 제거.
 * Gemini Live API 스트리밍 세션에서 최근 N개 청크를 관리할 때 사용.
 */
export class PcmChunkBuffer {
  private buffer: PcmChunk[] = [];

  constructor(private readonly maxLength = 50) {}

  push(chunk: PcmChunk): void {
    this.buffer.push(chunk);
    if (this.buffer.length > this.maxLength) this.buffer.shift();
  }

  /** 모든 청크 반환 (시간순) */
  getAll(): readonly PcmChunk[] { return this.buffer; }

  /** 가장 최근 청크 */
  getLast(): PcmChunk | undefined { return this.buffer[this.buffer.length - 1]; }

  /** 특정 timestamp 이후 청크만 반환 */
  getSince(sinceTimestamp: number): PcmChunk[] {
    return this.buffer.filter((c) => c.timestamp > sinceTimestamp);
  }

  clear(): void { this.buffer = []; }

  get size(): number { return this.buffer.length; }
}
