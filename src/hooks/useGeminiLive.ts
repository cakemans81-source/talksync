'use client';

/**
 * useGeminiLive.ts — Gemini Multimodal Live API 양방향 WebSocket 훅
 *
 * 데이터 흐름:
 *   [시스템 오디오] → VAD(onSpeechEnd) → sendAudioChunk() → [WS → Gemini]
 *                                                                    ↓
 *   [이어폰 재생] ← scheduleAudioChunk() ← [WS ← serverContent.modelTurn]
 *
 * AEC 게이트:
 *   muteUntilRef → attachVAD({ muteUntilRef }) 에 주입
 *   → Gemini 응답 재생 중 VAD 콜백 억제 → 에코 루프(Howling) 차단
 */

import { useRef, useCallback, useState, useEffect } from 'react';
import { WavAccumulator } from '@/lib/wavExporter';
import { isPhysicalOutputDevice, isVirtualAudioDevice } from '@/lib/audioDeviceBinding';
import {
  GEMINI_LIVE_TRANSLATE_CONTEXT_WINDOW_COMPRESSION,
  GEMINI_LIVE_TRANSLATE_DISPLAY_NAME,
  GEMINI_LIVE_TRANSLATE_MODEL,
  GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE,
} from '@/lib/geminiModels';

// ─────────────────────────────────────────────────────────────────────────────
// Gemini Live Translate API — BidiGenerateContent 엔드포인트
// Ref: https://ai.google.dev/api/multimodal-live
// ─────────────────────────────────────────────────────────────────────────────
const WS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** TalkSync Tx setSinkId 실패 시 txError 메시지 */
const GEMINI_LIVE_TX_SINK_FAILED_MESSAGE =
  '회의방 송출 장치(TalkSync Virtual Microphone) 연결 실패 — 상대방에게 번역 음성이 전달되지 않습니다';

/** Gemini Live Translate API 출력 PCM 샘플레이트 (고정값) */
const OUTPUT_SAMPLE_RATE = 24000;

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

export type GeminiLiveState = 'disconnected' | 'connecting' | 'ready' | 'error';

export type GeminiLiveConfig = {
  /** Gemini API 키 */
  apiKey: string;
  /**
   * Gemini Live Translate 지원 모델
   * 기본: GEMINI_LIVE_TRANSLATE_MODEL
   */
  model?: string;
  /**
   * 시스템 지침 — 역할/행동 정의
   * 예: "너는 전문 동시통역사다. 상대방의 말을 듣고 즉시 한국어로 번역하여 음성으로 출력하라."
   */
  systemInstruction?: string;
  /**
   * Gemini Live Translate 전용 출력 언어 코드.
   * Raw WebSocket setup.generationConfig.translationConfig.targetLanguageCode로 전달한다.
   */
  translationTargetLanguageCode?: string;
  /**
   * 응답 음성 프리셋
   * 지원: 'Aoede' | 'Puck' | 'Charon' | 'Fenrir' | 'Kore' | 'Zephyr'
   * 기본: 'Aoede'
   */
  voiceName?: string;
  /**
   * 이어폰/스피커 출력 장치 ID (AudioContext.setSinkId, Chrome 110+)
   * useAudioRouter의 earphoneDeviceId 값을 전달
   */
  outputDeviceId?: string;
  /**
   * TalkSync 가상 마이크 출력 장치 ID — Discord/Teams 전달용
   * earphone 과 동시에 PCM 재생 (setSinkId 라우팅)
   */
  virtualMicDeviceId?: string;
  /**
   * true: 이어폰(로컬) 출력 차단 — TalkSync Tx 전용 세션에 사용
   * 내 마이크 번역이 이어폰으로 역류하는 메아리 현상 방지
   * 기본: false
   */
  muteLocalOutput?: boolean;
  /**
   * 입력 오디오 샘플레이트 (systemAudioCapture.ts는 16000Hz 고정)
   * 기본: 16000
   */
  inputSampleRate?: number;
};

// AudioContext + setSinkId 확장 타입 (Chrome 110+)
type AudioContextWithSink = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
};

// ── Server → Client 메시지 스키마 ─────────────────────────
type ServerMessage = {
  /** setup 수신 확인 — 세션 준비 완료 신호 */
  setupComplete?: Record<string, never>;
  serverContent?: {
    /** 모델의 응답 파트 (오디오 / 텍스트 혼재 가능) */
    modelTurn?: {
      parts: Array<{
        inlineData?: {
          /** "audio/pcm;rate=24000" */
          mimeType: string;
          /** base64(Int16 LE PCM, 24kHz, mono) */
          data: string;
        };
        text?: string;
      }>;
    };
    /** true = 이번 턴 응답 완료 */
    turnComplete?: boolean;
    /** true = 새 입력으로 이전 응답 중단됨 */
    interrupted?: boolean;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// PCM 변환 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

/**
 * base64(Int16 LE PCM) → Float32Array [-1, 1]
 * Gemini 서버 응답 오디오 디코딩에 사용
 */
function base64PcmToFloat32(base64: string): Float32Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
  }
  return float32;
}

/** 이미 연결(중)인 세션과 다른 config로 connect()가 호출되면 경고 (세션은 유지, apiKey 값은 출력하지 않음) */
function warnIfConfigDiffers(current: GeminiLiveConfig | null, next: GeminiLiveConfig) {
  if (!current) return;
  const keys = new Set([...Object.keys(current), ...Object.keys(next)] as Array<keyof GeminiLiveConfig>);
  // muteLocalOutput은 setMonitorOutput()으로 런타임 변경되므로 비교에서 제외
  keys.delete('muteLocalOutput');
  const differs = [...keys].filter((k) => current[k] !== next[k]);
  if (differs.length > 0) {
    console.warn(
      '[GeminiLive] connect() 무시 — 이미 연결(중)인 세션의 설정을 유지합니다. 다른 키:',
      differs.join(', '),
      '— 설정을 바꾸려면 disconnect() 후 connect() 하세요.'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// useGeminiLive Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useGeminiLive() {
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContextWithSink | null>(null);

  // 다음 청크를 재생할 AudioContext 타임라인 포인터 (초 단위)
  // 이전 청크 종료 시각에 새 청크를 이어 붙여 갭 없는 연속 재생 보장
  const nextPlayTimeRef = useRef<number>(0);
  // TalkSync Tx AudioContext + 재생 타임라인
  const vbCtxRef = useRef<AudioContextWithSink | null>(null);
  const nextVbPlayTimeRef = useRef<number>(0);

  /**
   * AEC 게이트 Ref ─ attachVAD({ muteUntilRef }) 에 그대로 주입
   *
   * Gemini 응답 오디오 재생 예상 종료 시각(ms)을 저장.
   * Date.now() < muteUntilRef.current 이면 VAD onSpeechEnd 억제
   * → TTS/응답 오디오가 VAD → Gemini → 재생으로 되먹임되는 Howling 차단
   */
  const muteUntilRef = useRef<number>(0);

  const configRef = useRef<GeminiLiveConfig | null>(null);
  // 자동 재연결 제어
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false); // 의도적 종료 플래그
  // 재연결 타이머가 최신 connect를 호출하기 위한 Ref (connect의 자기 참조 회피)
  const connectRef = useRef<((config: GeminiLiveConfig) => Promise<void>) | null>(null);
  // keepalive ping 타이머
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // connect() 세대 카운터 — disconnect()/새 connect() 시 증가.
  // await 도중 세대가 바뀌면 진행 중이던 connect는 소켓을 만들지 않고 종료한다.
  const connectSeqRef = useRef(0);
  // 진행 중인 connect() Promise — 중복 호출 시 같은 Promise를 반환 (소켓 이중 생성 방지)
  const connectPromiseRef = useRef<Promise<void> | null>(null);

  const earphoneSinkReadyRef = useRef<boolean>(true);

  // ── 자막 추출 Refs ────────────────────────────────────────
  // 모드(초저지연/프리미엄)와 무관하게 part.text를 수집 → turnComplete 시 콜백 실행
  const subtitleAccRef = useRef<string>('');
  const onSubtitleRef = useRef<((text: string) => void) | null>(null);

  // ── 커스텀 TTS 모드 제어 Refs ─────────────────────────────────
  // enableCustomTTS() 호출 시 true → serverContent 수신 시 PCM 재생 차단, 텍스트 수집
  const customTtsModeRef = useRef<boolean>(false);
  const textAccumulatorRef = useRef<string>('');
  const onTranscriptReadyRef = useRef<((text: string) => void) | null>(null);

  // ── WAV 자동 저장 Refs ────────────────────────────────────
  // enableWavExport() 호출 시 true → 모든 PCM 청크를 누적 → turnComplete 시 flush
  const wavExportEnabledRef = useRef<boolean>(false);
  // Output PCM 녹음용 어큐뮬레이터 (Gemini → 이어폰 방향)
  const wavAccRef = useRef<WavAccumulator | null>(null);
  // Input PCM 녹음용 어큐뮬레이터 (마이크 → Gemini 방향)
  const wavInputAccRef = useRef<WavAccumulator | null>(null);

  const [state, setState] = useState<GeminiLiveState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  // TalkSync Tx(회의방 송출) 경로 실패 — 세션은 'ready'로 계속되지만 상대방에게 번역 음성이 전달되지 않음
  const [txError, setTxError] = useState<string | null>(null);

  // ── AudioContext 지연 초기화 ────────────────────────────────
  // 브라우저 AutoPlay 정책: 사용자 제스처(버튼 클릭) 이후에만 생성 가능
  const getCtx = useCallback(async (outputDeviceId?: string): Promise<AudioContextWithSink> => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE }) as AudioContextWithSink;
    }
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();

    earphoneSinkReadyRef.current = true;

    let targetSinkId = outputDeviceId;

    // 만약 outputDeviceId가 'default'인 경우 물리 장치로 자동 매핑 시도
    if (targetSinkId === 'default' || !targetSinkId) {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const outputs = all.filter((d) => d.kind === 'audiooutput');
        const physicalOutput = outputs.find(isPhysicalOutputDevice);
        if (physicalOutput) {
          targetSinkId = physicalOutput.deviceId;
          console.log('[GeminiLive] outputDeviceId가 default이므로 물리 장치 자동 대체:', physicalOutput.label);
        } else {
          console.error('[GeminiLive] [누수 방쇄] 물리 출력 장치를 찾을 수 없어 이어폰 출력을 차단합니다.');
          earphoneSinkReadyRef.current = false;
        }
      } catch (e) {
        console.error('[GeminiLive] 장치 스캔 오류 및 출력 차단:', e);
        earphoneSinkReadyRef.current = false;
      }
    } else {
      // 지정된 장치가 가상 디바이스인지 검증하여 차단
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        const outputs = all.filter((d) => d.kind === 'audiooutput');
        const currentDevice = outputs.find((d) => d.deviceId === targetSinkId);
        if (currentDevice && isVirtualAudioDevice(currentDevice)) {
          console.error('[GeminiLive] [누수 방쇄] 가상 장치로의 이어폰 출력이 감지되어 차단합니다:', currentDevice.label);
          earphoneSinkReadyRef.current = false;
        }
      } catch (e) {
        console.error('[GeminiLive] 장치 검증 오류:', e);
      }
    }

    if (earphoneSinkReadyRef.current && targetSinkId && typeof ctxRef.current.setSinkId === 'function') {
      try {
        await ctxRef.current.setSinkId(targetSinkId);
        console.log('[GeminiLive] 출력 장치 →', targetSinkId);
      } catch (e) {
        console.error('[GeminiLive] setSinkId 실패로 인해 재생이 차단되었습니다 (누수 방쇄):', e);
        earphoneSinkReadyRef.current = false;
      }
    }
    return ctxRef.current;
  }, []);

  // ── PCM 청크 스케줄 재생 ─────────────────────────────────────
  // AudioContext 타임라인에 순서대로 예약 → 네트워크 지터와 무관하게 끊김 없이 재생
  // 재생 잔여 시간 기반으로 muteUntilRef 갱신 → AEC 게이트 자동 연장
  const scheduleAudioChunk = useCallback((base64: string) => {
    const float32 = base64PcmToFloat32(base64);
    if (float32.length === 0) return;

    // ── WAV 누적 (출력 스트림 레코딩) ─────────────────────────
    // wavExportEnabled 상태와 무관하게 어큐뮬레이터가 살아있으면 항상 누적
    wavAccRef.current?.push(float32);

    // ── 이어폰 AudioContext ──────────────────────────────────
    // muteLocalOutput: true 인 세션(내 마이크 전용)은 이어폰 출력 차단
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== 'closed' && !configRef.current?.muteLocalOutput && earphoneSinkReadyRef.current) {
      const audioBuffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
      source.start(startAt);
      nextPlayTimeRef.current = startAt + audioBuffer.duration;
      // AEC 게이트 갱신 — 이어폰 출력이 있을 때만 (메아리 방지용)
      const remainingMs = Math.max(0, nextPlayTimeRef.current - ctx.currentTime) * 1000;
      muteUntilRef.current = Date.now() + remainingMs + 300;
    }

    // ── TalkSync Tx AudioContext (이어폰과 동시 송출) ─────────
    const vbCtx = vbCtxRef.current;
    if (vbCtx && vbCtx.state !== 'closed') {
      const audioBuffer = vbCtx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
      const source = vbCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(vbCtx.destination);
      const startAt = Math.max(vbCtx.currentTime + 0.02, nextVbPlayTimeRef.current);
      source.start(startAt);
      nextVbPlayTimeRef.current = startAt + audioBuffer.duration;
    }
  }, []);

  // ── 서버 메시지 파싱 & 처리 ─────────────────────────────────
  const handleMessage = useCallback(
    (raw: string) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // 파싱 불가 메시지 무시
      }

      // ── 1) setupComplete: 세션 준비 완료 ──────────────────
      if (msg.setupComplete !== undefined) {
        console.log('[GeminiLive] setupComplete ✓ — 오디오 스트리밍 준비 완료');
        setState('ready');
        return;
      }

      // ── 2) serverContent: 모델 응답 ───────────────────────
      if (msg.serverContent) {
        const { modelTurn, turnComplete, interrupted } = msg.serverContent;

        // 응답 중단 (새 입력으로 덮어씌워짐)
        // 재생 타임라인 리셋 + AEC 게이트 즉시 해제 + 텍스트/WAV 버퍼 초기화
        if (interrupted) {
          console.log('[GeminiLive] interrupted — 재생 타임라인 리셋');
          if (ctxRef.current) nextPlayTimeRef.current = ctxRef.current.currentTime;
          if (vbCtxRef.current) nextVbPlayTimeRef.current = vbCtxRef.current.currentTime;
          muteUntilRef.current = 0;
          textAccumulatorRef.current = '';
          subtitleAccRef.current = '';
          // WAV 버퍼 드롭 (중단된 턴 — 불완전한 오디오)
          wavAccRef.current?.reset();
          return;
        }

        // 모드별 파트 처리
        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            if (!customTtsModeRef.current) {
              // ⚡ 초저지연 모드: PCM 오디오 즉시 재생
              if (part.inlineData?.mimeType.startsWith('audio/pcm') && part.inlineData.data) {
                scheduleAudioChunk(part.inlineData.data);
              }
            } else {
              // 🎧 프리미엄 모드: PCM 차단, 텍스트 트랜스크립트만 수집
              if (part.text) {
                textAccumulatorRef.current += part.text;
              }
            }
            // 자막용 텍스트 — 모드 무관하게 수집
            if (part.text) subtitleAccRef.current += part.text;
          }
        }

        // 턴 완료 처리
        if (turnComplete) {
          // 자막 콜백 — 모드 무관하게 실행
          const subtitleText = subtitleAccRef.current.trim();
          subtitleAccRef.current = '';
          if (subtitleText) onSubtitleRef.current?.(subtitleText);

          if (customTtsModeRef.current) {
            // 🎧 프리미엄 모드: 수집된 텍스트를 외부 TTS 콜백으로 전달
            const accumulated = textAccumulatorRef.current.trim();
            textAccumulatorRef.current = '';
            if (accumulated) {
              onTranscriptReadyRef.current?.(accumulated);
            }
          } else {
            // ⚡ 초저지연 모드: 오디오가 없을 때 AEC 게이트 해제
            const ctx = ctxRef.current;
            const hasScheduledAudio = ctx && nextPlayTimeRef.current > ctx.currentTime;
            if (!hasScheduledAudio) {
              muteUntilRef.current = 0;
            }
          }

          // ── WAV 자동 저장 (출력) ─────────────────────────────
          // turnComplete = 1개의 완전한 통역 발화 단위 → 바로 덤프
          if (wavExportEnabledRef.current && wavAccRef.current && !wavAccRef.current.isEmpty) {
            // 비동기 flush (UI 블로킹 없음)
            wavAccRef.current.flush({ minSamples: 2400 }).catch((e) =>
              console.warn('[GeminiLive] WAV flush 실패:', e)
            );
          }

          console.log('[GeminiLive] turnComplete');
        }
      }
    },
    [scheduleAudioChunk]
  );

  // ── WebSocket 연결 & Setup 메시지 전송 ──────────────────────
  const connectImpl = useCallback(
    async (config: GeminiLiveConfig, seq: number) => {
      // 이 connect() 호출이 여전히 최신인지 (disconnect()/새 connect()로 무효화되지 않았는지)
      const isStale = () => connectSeqRef.current !== seq;

      configRef.current = config;
      setState('connecting');
      setError(null);
      setTxError(null);

      // AudioContext 미리 초기화 (재생 장치 라우팅 포함)
      const ctx = await getCtx(config.outputDeviceId);
      if (isStale()) return;
      nextPlayTimeRef.current = ctx.currentTime;

      // TalkSync Tx AudioContext 초기화
      if (config.virtualMicDeviceId && config.virtualMicDeviceId !== 'default') {
        if (!vbCtxRef.current || vbCtxRef.current.state === 'closed') {
          vbCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE }) as AudioContextWithSink;
        }
        const vbCtx = vbCtxRef.current;
        if (vbCtx.state === 'suspended') await vbCtx.resume();
        if (isStale()) return;
        let vbSinkOk = false;
        if (typeof vbCtx.setSinkId === 'function') {
          try {
            await vbCtx.setSinkId(config.virtualMicDeviceId);
            vbSinkOk = true;
            console.log('[GeminiLive] TalkSync Tx 출력 장치 →', config.virtualMicDeviceId);
          } catch (e) {
            console.error('[GeminiLive] TalkSync Tx setSinkId 실패 — Tx 출력 비활성화 (기본 출력 누수 방지):', e);
          }
        } else {
          console.error('[GeminiLive] setSinkId 미지원 — TalkSync Tx 출력 비활성화 (기본 출력 누수 방지)');
        }
        if (isStale()) return;
        if (vbSinkOk) {
          nextVbPlayTimeRef.current = vbCtx.currentTime;
        } else {
          // setSinkId 실패 시 vbCtx는 시스템 기본 출력으로 재생되므로 사용하지 않는다.
          if (vbCtxRef.current === vbCtx) vbCtxRef.current = null;
          vbCtx.close().catch(() => {});
          setTxError(GEMINI_LIVE_TX_SINK_FAILED_MESSAGE);
        }
      } else if (vbCtxRef.current) {
        // 이번 세션은 Tx 출력이 없음 → 이전 세션의 Tx sink로 오디오가 흘러가지 않도록 정리
        vbCtxRef.current.close().catch(() => {});
        vbCtxRef.current = null;
        nextVbPlayTimeRef.current = 0;
      }

      const ws = new WebSocket(`${WS_ENDPOINT}?key=${config.apiKey}`);
      wsRef.current = ws;
      // 이 소켓이 여전히 현재 소켓인지 — 이전 소켓의 늦은 이벤트가 새 세션을 덮어쓰지 않도록
      const isCurrent = () => wsRef.current === ws;

      // onerror/onclose 중복 setState 방지
      let didError = false;
      // 이 소켓이 한 번이라도 열렸는지 — 사용자 connect()의 최초 시도가 열리기 전에 실패하면 재시도하지 않음
      let opened = false;

      ws.onopen = () => {
        if (!isCurrent()) return;
        opened = true;
        reconnectCountRef.current = 0; // 연결 성공 → 재시도 카운터 초기화
        // ── Setup 메시지: 세션 초기화 ─────────────────────────
        // responseModalities: ['AUDIO'] → 텍스트 없이 음성으로만 응답
        // translationConfig is the primary Live Translation target-language path.
        // systemInstruction remains only for role/behavior guidance.
        const generationConfig = {
          responseModalities: ['AUDIO'],
          ...(config.translationTargetLanguageCode && {
            translationConfig: {
              targetLanguageCode: config.translationTargetLanguageCode,
            },
          }),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.voiceName ?? 'Aoede',
              },
            },
          },
        };

        const systemInstructionText = config.systemInstruction?.trim();

        const setupMsg = {
          setup: {
            model: config.model ?? GEMINI_LIVE_TRANSLATE_MODEL,
            generationConfig,
            contextWindowCompression: GEMINI_LIVE_TRANSLATE_CONTEXT_WINDOW_COMPRESSION,
            ...(systemInstructionText && {
              systemInstruction: {
                parts: [{ text: systemInstructionText }],
              },
            }),
          },
        };
        ws.send(JSON.stringify(setupMsg));
        console.log(`[GeminiLive] ${GEMINI_LIVE_TRANSLATE_DISPLAY_NAME} setup 전송 완료`);

        // Live API는 realtimeInput 오디오 스트림 자체가 세션 활동 신호다.
        // 빈 clientContent keepalive는 일부 모델에서 invalid argument로 연결을 끊을 수 있다.
        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }
      };

      ws.onmessage = (ev) => {
        if (!isCurrent()) return;
        // Gemini Live는 JSON string 또는 Blob으로 메시지를 전송할 수 있음
        if (typeof ev.data === 'string') {
          handleMessage(ev.data);
        } else if (ev.data instanceof Blob) {
          ev.data.text().then((text) => {
            if (isCurrent()) handleMessage(text);
          }).catch(() => {});
        }
      };

      ws.onerror = () => {
        if (!isCurrent()) return;
        didError = true;
        const msg = GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE;
        console.error('[GeminiLive]', msg);
        // 메시지만 보관 — state 'error'는 onclose에서 재연결이 더 이상 없을 때만 발행한다.
        // (여기서 'error'를 발행하면 소비자는 세션을 포기했는데 훅은 재연결해 고아 세션이 생김)
        setError(msg);
      };

      ws.onclose = (ev) => {
        // disconnect() 또는 새 connect() 이후 도착한 이전 소켓의 close → 무시
        // (새 소켓을 null로 덮어쓰거나 state를 'disconnected'로 되돌리지 않음, 재연결도 예약하지 않음)
        if (!isCurrent()) return;
        wsRef.current = null;
        // keepalive 중단
        if (keepaliveTimerRef.current) {
          clearInterval(keepaliveTimerRef.current);
          keepaliveTimerRef.current = null;
        }
        if (!didError) {
          console.log('[GeminiLive] 연결 종료:', ev.code, ev.reason || '정상 종료');
        }
        if (intentionalDisconnectRef.current) {
          // 사용자가 직접 disconnect() 호출 → 재연결 안 함
          intentionalDisconnectRef.current = false;
          setState('disconnected');
          return;
        }
        // 예상치 못한 연결 끊김 → 자동 재연결 (최대 3회)
        // 단, 사용자 connect()의 최초 시도가 열리기도 전에 실패한 경우(키 오류/네트워크 없음)는
        // 재시도 없이 즉시 최종 상태 — reconnectCountRef는 재연결 예약 시 먼저 증가하므로 0이면 최초 시도.
        const MAX_RETRIES = 3;
        const initialAttemptFailed = !opened && reconnectCountRef.current === 0;
        if (!initialAttemptFailed && reconnectCountRef.current < MAX_RETRIES && configRef.current) {
          const delay = Math.pow(2, reconnectCountRef.current) * 1000; // 1s, 2s, 4s
          reconnectCountRef.current += 1;
          console.log(`[GeminiLive] ${delay/1000}초 후 자동 재연결 시도 (${reconnectCountRef.current}/${MAX_RETRIES})`);
          // 재연결 대기 중 표시 (소켓 없음). 소비자의 'ready' 분기는 VAD가 이미 붙어 있으면 재실행되지 않는다.
          setState('connecting');
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (configRef.current && !intentionalDisconnectRef.current) {
              connectRef.current?.(configRef.current).catch((e) =>
                console.error('[GeminiLive] 자동 재연결 실패:', e)
              );
            }
          }, delay);
        } else {
          // 재연결 없음(최초 시도 실패 또는 재시도 소진) → 여기서만 최종 'error'/'disconnected' 발행
          reconnectCountRef.current = 0;
          if (didError) {
            setError(GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE);
            setState('error');
          } else if (ev.code !== 1000) {
            const reason = ev.reason ? ` (${ev.reason})` : '';
            const msg = `${GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE} [close ${ev.code}${reason}]`;
            console.error('[GeminiLive]', msg);
            setError(msg);
            setState('error');
          } else {
            setState('disconnected');
          }
        }
      };
    },
    [getCtx, handleMessage]
  );

  const connect = useCallback(
    (config: GeminiLiveConfig): Promise<void> => {
      // 이미 연결됐거나 연결 중인 소켓이 있으면 두 번째 소켓을 만들지 않는다.
      // 다른 config로 호출돼도 기존 세션을 유지한다 (console.warn 후 반환).
      // 통화 중인 세션을 끊고 재연결하는 것보다 안전 — 설정을 바꾸려면 disconnect() 후 connect().
      const existing = wsRef.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        warnIfConfigDiffers(configRef.current, config);
        return Promise.resolve();
      }
      // 소켓 생성 전(AudioContext/setSinkId await 중)인 connect()가 있으면 그 Promise를 공유
      if (connectPromiseRef.current) {
        warnIfConfigDiffers(configRef.current, config);
        return connectPromiseRef.current;
      }

      // 새 세션 시작 — 이전 disconnect()의 의도적 종료 플래그 해제, 대기 중인 자동 재연결 취소
      intentionalDisconnectRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      connectSeqRef.current += 1;
      const seq = connectSeqRef.current;
      const promise = connectImpl(config, seq).finally(() => {
        if (connectPromiseRef.current === promise) connectPromiseRef.current = null;
      });
      connectPromiseRef.current = promise;
      return promise;
    },
    [connectImpl]
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ── 오디오 청크 전송 ─────────────────────────────────────────
  // VAD onSpeechEnd 콜백에서 chunk.base64를 그대로 전달
  //
  // 사용 예:
  //   audioRouter.startVADWeb('sys', {
  //     onSpeechEnd: (chunk) => sendAudioChunk(chunk.base64),
  //   }, { muteUntilRef })
  const sendAudioChunk = useCallback((base64: string, inputSampleRate?: number) => {
    if (!base64) return;

    // ── WAV 누적 (입력 스트림 — 마이크 방향) ──────────────────
    if (wavExportEnabledRef.current && wavInputAccRef.current) {
      // base64 → Int16 LE 바이트 직접 누적 (재디코딩 비용 제로)
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      wavInputAccRef.current.pushInt16Bytes(bytes);
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const rate = inputSampleRate ?? configRef.current?.inputSampleRate ?? 16000;
    // 새 API 포맷: realtimeInput.audio (mediaChunks deprecated in gemini-3.1+)
    ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            data: base64,
            mimeType: `audio/pcm;rate=${rate}`,
          },
        },
      })
    );
  }, []);

  // ── 텍스트 턴 전송 (테스트 / 혼합 입력) ──────────────────────
  const sendTextTurn = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        },
      })
    );
  }, []);

  // ── WAV Export 제어 ──────────────────────────────────────────
  /**
   * WAV 자동 저장 활성화
   * 이후 수신되는 모든 Gemini 출력 PCM을 turnComplete 단위로 WAV 파일로 덤프
   *
   * @param opts.outputPrefix   출력(통역 음성) 파일명 접두사 (기본: 'TalkSync_통역')
   * @param opts.inputPrefix    입력(내 음성) 파일명 접두사 (기본: 'TalkSync_입력')
   *                            null 전달 시 입력 녹음 비활성화
   * @param opts.inputSampleRate 입력 스트림 샘플레이트 (기본: 16000)
   */
  const enableWavExport = useCallback((
    opts?: {
      outputPrefix?: string;
      inputPrefix?: string | null;
      inputSampleRate?: number;
    }
  ) => {
    wavExportEnabledRef.current = true;
    wavAccRef.current = new WavAccumulator(
      { sampleRate: OUTPUT_SAMPLE_RATE, numChannels: 1, bitsPerSample: 16 },
      opts?.outputPrefix ?? 'TalkSync_통역'
    );
    if (opts?.inputPrefix !== null) {
      wavInputAccRef.current = new WavAccumulator(
        { sampleRate: opts?.inputSampleRate ?? 16000, numChannels: 1, bitsPerSample: 16 },
        opts?.inputPrefix ?? 'TalkSync_입력'
      );
    }
    console.log('[GeminiLive] WAV Export 활성화 — 턴 완료 시 자동 저장');
  }, []);

  /**
   * WAV 자동 저장 비활성화 + 현재 버퍼 flush (미처리 오디오 마저 저장)
   */
  const disableWavExport = useCallback(async () => {
    wavExportEnabledRef.current = false;
    const flushOut   = wavAccRef.current?.flush({ minSamples: 2400 });
    const flushIn    = wavInputAccRef.current?.flush({ minSamples: 1600 });
    await Promise.allSettled([flushOut, flushIn].filter(Boolean));
    wavAccRef.current      = null;
    wavInputAccRef.current = null;
    console.log('[GeminiLive] WAV Export 비활성화');
  }, []);

  // ── 커스텀 TTS 모드 제어 ─────────────────────────────────────
  /**
   * 프리미엄 모드 활성화 — PCM 재생 차단, 텍스트 트랜스크립트 → 외부 TTS 콜백
   * @param onTranscriptReady 턴 완료 시 호출될 콜백 (번역 완성 텍스트)
   */
  const enableCustomTTS = useCallback((onTranscriptReady: (text: string) => void) => {
    customTtsModeRef.current = true;
    onTranscriptReadyRef.current = onTranscriptReady;
    textAccumulatorRef.current = '';
    console.log('[GeminiLive] 프리미엄 모드 (커스텀 TTS) 활성화');
  }, []);

  /** 초저지연 모드로 복귀 — PCM 직접 재생 재개 */
  const disableCustomTTS = useCallback(() => {
    customTtsModeRef.current = false;
    onTranscriptReadyRef.current = null;
    textAccumulatorRef.current = '';
    console.log('[GeminiLive] 초저지연 모드 (Gemini 네이티브 오디오) 활성화');
  }, []);

  /**
   * AEC 게이트 직접 설정 — 커스텀 TTS 재생 시간 외부에서 주입
   * @param ms Date.now() 기준 mute 해제 시각 (밀리초)
   */
  const setMuteUntil = useCallback((ms: number) => {
    muteUntilRef.current = ms;
  }, []);

  // ── 연결 종료 ────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true; // 의도적 종료 표시
    // 진행 중인 connect()(소켓 생성 전 await 구간)를 무효화
    connectSeqRef.current += 1;
    connectPromiseRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    // wsRef를 먼저 비운다 → 이 소켓의 늦은 onclose/onmessage는 isCurrent() 가드로 무시됨
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close(1000, 'user disconnect');
    // TalkSync Tx AudioContext 정리 — 다음 세션이 Tx 없이 시작될 때 이전 sink로 송출되지 않도록
    // (재생 대기 중인 번역 음성이 회의 앱으로 계속 나가는 것도 즉시 중단)
    if (vbCtxRef.current) {
      vbCtxRef.current.close().catch(() => {});
      vbCtxRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    nextVbPlayTimeRef.current = 0;
    muteUntilRef.current = 0;
    subtitleAccRef.current = '';
    reconnectCountRef.current = 0;
    setTxError(null);
    // 세션 종료 시 남은 버퍼 최종 flush
    if (wavExportEnabledRef.current) {
      wavAccRef.current?.flush({ minSamples: 2400 }).catch(() => {});
      wavInputAccRef.current?.flush({ minSamples: 1600 }).catch(() => {});
    }
    setState('disconnected');
  }, []);

  // ── 자막 콜백 등록/해제 ──────────────────────────────────────
  const setSubtitleCallback = useCallback((cb: ((text: string) => void) | null) => {
    onSubtitleRef.current = cb;
  }, []);

  // ── 런타임 이어폰 모니터링 토글 ──────────────────────────────
  // 호출자가 connect()에 넘긴 config 객체를 변형하지 않도록 복사본으로 교체
  const setMonitorOutput = useCallback((enabled: boolean) => {
    if (configRef.current) {
      configRef.current = { ...configRef.current, muteLocalOutput: !enabled };
    }
  }, []);

  // ── 언마운트 정리 ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      intentionalDisconnectRef.current = true;
      connectSeqRef.current += 1;
      connectPromiseRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
      wsRef.current?.close(1000, 'unmount');
      ctxRef.current?.close();
      vbCtxRef.current?.close();
    };
  }, []);

  return {
    /** WebSocket + 세션 상태 ('disconnected' | 'connecting' | 'ready' | 'error') */
    state,
    /** 오류 메시지 (state === 'error' 일 때 표시) */
    error,
    /**
     * TalkSync Tx(회의방 송출) setSinkId 실패 메시지 — null이면 정상 또는 Tx 미사용.
     * 세션 state는 'ready'로 유지되므로(fail-closed: Tx 출력만 차단) UI에서 별도 경고로 표시해야 한다.
     */
    txError,
    /**
     * AEC 게이트 Ref — VAD attachVAD({ muteUntilRef }) 에 직접 주입
     *
     * Gemini 응답 재생 중 & 재생 후 5초 동안 VAD 억제됨
     * → 응답 음성이 시스템 오디오로 재캡처되는 에코 루프 차단
     */
    muteUntilRef,
    /** WebSocket 연결 시작 & 세션 setup 전송 */
    connect,
    /** 연결 종료 & 재생 타임라인 초기화 */
    disconnect,
    /**
     * VAD onSpeechEnd → Gemini 실시간 오디오 스트리밍
     * chunk.base64를 그대로 전달 (audio/pcm;rate=16000)
     */
    sendAudioChunk,
    /** 텍스트 입력 (테스트 / 혼합 모드) */
    sendTextTurn,
    /**
     * 프리미엄 모드 활성화 — PCM 재생 차단, 텍스트 트랜스크립트 → 콜백
     * liveActive 중에도 즉시 적용 (재연결 불필요)
     */
    enableCustomTTS,
    /** 초저지연 모드로 전환 */
    disableCustomTTS,
    /** 커스텀 TTS 재생 시간을 AEC 게이트에 주입 */
    setMuteUntil,
    /**
     * 자막 콜백 등록 — turnComplete 시 수집된 텍스트를 전달
     * null 전달 시 콜백 해제
     */
    setSubtitleCallback,
    /**
     * 런타임 muteLocalOutput 토글 — 재연결 없이 즉시 적용
     * true: 이어폰 출력 차단(기본), false: 이어폰으로도 재생(모니터링)
     */
    setMonitorOutput,
    /**
     * WAV 자동 저장 활성화
     * Gemini 출력 PCM을 turnComplete 단위로 물리 WAV 파일 저장
     *
     * 사용 예:
     *   geminiLive.enableWavExport()          // 기본 — 통역 음성만
     *   geminiLive.enableWavExport({          // 고급 — 입출력 동시 캡처
     *     outputPrefix: 'TalkSync_통역',
     *     inputPrefix:  'TalkSync_입력',
     *     inputSampleRate: 16000,
     *   });
     */
    enableWavExport,
    /**
     * WAV 자동 저장 비활성화 + 잔여 버퍼 최종 flush
     * disconnect() 전에 호출하거나, disconnect()가 자동 처리
     */
    disableWavExport,
  };
}
