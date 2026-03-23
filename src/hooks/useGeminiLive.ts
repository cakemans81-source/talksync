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

// ─────────────────────────────────────────────────────────────────────────────
// Gemini Multimodal Live API — BidiGenerateContent 엔드포인트
// Ref: https://ai.google.dev/api/multimodal-live
// ─────────────────────────────────────────────────────────────────────────────
const WS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

/** Gemini Live API 출력 PCM 샘플레이트 (고정값) */
const OUTPUT_SAMPLE_RATE = 24000;

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

export type GeminiLiveState = 'disconnected' | 'connecting' | 'ready' | 'error';

export type GeminiLiveConfig = {
  /** Gemini API 키 */
  apiKey: string;
  /**
   * Gemini Live 지원 모델
   * 기본: 'models/gemini-2.5-flash-native-audio-preview-12-2025'
   */
  model?: string;
  /**
   * 시스템 지침 — 역할/행동 정의
   * 예: "너는 전문 동시통역사다. 상대방의 말을 듣고 즉시 한국어로 번역하여 음성으로 출력하라."
   */
  systemInstruction?: string;
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
   * VB-CABLE 가상 마이크 출력 장치 ID — Discord/Teams 전달용
   * earphone 과 동시에 PCM 재생 (setSinkId 라우팅)
   */
  virtualMicDeviceId?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// useGeminiLive Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useGeminiLive() {
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContextWithSink | null>(null);

  // 다음 청크를 재생할 AudioContext 타임라인 포인터 (초 단위)
  // 이전 청크 종료 시각에 새 청크를 이어 붙여 갭 없는 연속 재생 보장
  const nextPlayTimeRef = useRef<number>(0);
  // VB-CABLE AudioContext + 재생 타임라인
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

  // ── 자막 추출 Refs ────────────────────────────────────────
  // 모드(초저지연/프리미엄)와 무관하게 part.text를 수집 → turnComplete 시 콜백 실행
  const subtitleAccRef = useRef<string>('');
  const onSubtitleRef = useRef<((text: string) => void) | null>(null);

  // ── 커스텀 TTS 모드 제어 Refs ─────────────────────────────────
  // enableCustomTTS() 호출 시 true → serverContent 수신 시 PCM 재생 차단, 텍스트 수집
  const customTtsModeRef = useRef<boolean>(false);
  const textAccumulatorRef = useRef<string>('');
  const onTranscriptReadyRef = useRef<((text: string) => void) | null>(null);

  const [state, setState] = useState<GeminiLiveState>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // ── AudioContext 지연 초기화 ────────────────────────────────
  // 브라우저 AutoPlay 정책: 사용자 제스처(버튼 클릭) 이후에만 생성 가능
  const getCtx = useCallback(async (outputDeviceId?: string): Promise<AudioContextWithSink> => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE }) as AudioContextWithSink;
    }
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();

    if (outputDeviceId && typeof ctxRef.current.setSinkId === 'function') {
      try {
        await ctxRef.current.setSinkId(outputDeviceId);
        console.log('[GeminiLive] 출력 장치 →', outputDeviceId);
      } catch (e) {
        console.warn('[GeminiLive] setSinkId 실패 (Chrome 110+ 필요):', e);
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

    // ── 이어폰 AudioContext ──────────────────────────────────
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== 'closed') {
      const audioBuffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
      audioBuffer.copyToChannel(float32 as Float32Array<ArrayBuffer>, 0);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
      source.start(startAt);
      nextPlayTimeRef.current = startAt + audioBuffer.duration;
      // AEC 게이트 갱신
      const remainingMs = Math.max(0, nextPlayTimeRef.current - ctx.currentTime) * 1000;
      muteUntilRef.current = Date.now() + remainingMs + 5000;
    }

    // ── VB-CABLE AudioContext (이어폰과 동시 송출) ───────────
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
        // 재생 타임라인 리셋 + AEC 게이트 즉시 해제 + 텍스트 버퍼 초기화
        if (interrupted) {
          console.log('[GeminiLive] interrupted — 재생 타임라인 리셋');
          if (ctxRef.current) nextPlayTimeRef.current = ctxRef.current.currentTime;
          if (vbCtxRef.current) nextVbPlayTimeRef.current = vbCtxRef.current.currentTime;
          muteUntilRef.current = 0;
          textAccumulatorRef.current = '';
          subtitleAccRef.current = '';
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
          console.log('[GeminiLive] turnComplete');
        }
      }
    },
    [scheduleAudioChunk]
  );

  // ── WebSocket 연결 & Setup 메시지 전송 ──────────────────────
  const connect = useCallback(
    async (config: GeminiLiveConfig) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      configRef.current = config;
      setState('connecting');
      setError(null);

      // AudioContext 미리 초기화 (재생 장치 라우팅 포함)
      const ctx = await getCtx(config.outputDeviceId);
      nextPlayTimeRef.current = ctx.currentTime;

      // VB-CABLE AudioContext 초기화
      if (config.virtualMicDeviceId && config.virtualMicDeviceId !== 'default') {
        if (!vbCtxRef.current || vbCtxRef.current.state === 'closed') {
          vbCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE }) as AudioContextWithSink;
        }
        if (vbCtxRef.current.state === 'suspended') await vbCtxRef.current.resume();
        if (typeof vbCtxRef.current.setSinkId === 'function') {
          try {
            await vbCtxRef.current.setSinkId(config.virtualMicDeviceId);
            console.log('[GeminiLive] VB-CABLE 출력 장치 →', config.virtualMicDeviceId);
          } catch (e) {
            console.warn('[GeminiLive] VB-CABLE setSinkId 실패:', e);
          }
        }
        nextVbPlayTimeRef.current = vbCtxRef.current.currentTime;
      }

      const ws = new WebSocket(`${WS_ENDPOINT}?key=${config.apiKey}`);
      wsRef.current = ws;

      // onerror/onclose 중복 setState 방지
      let didError = false;

      ws.onopen = () => {
        // ── Setup 메시지: 세션 초기화 ─────────────────────────
        // response_modalities: ['AUDIO'] → 텍스트 없이 음성으로만 응답
        // system_instruction → 통역사 역할 및 언어 지시
        const setupMsg = {
          setup: {
            model: config.model ?? 'models/gemini-2.5-flash-native-audio-preview-12-2025',
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: config.voiceName ?? 'Aoede',
                  },
                },
              },
            },
            ...(config.systemInstruction && {
              system_instruction: {
                parts: [{ text: config.systemInstruction }],
              },
            }),
          },
        };
        ws.send(JSON.stringify(setupMsg));
        console.log('[GeminiLive] 연결됨 — setup 전송 완료');
      };

      ws.onmessage = (ev) => {
        // Gemini Live는 JSON string 또는 Blob으로 메시지를 전송할 수 있음
        if (typeof ev.data === 'string') {
          handleMessage(ev.data);
        } else if (ev.data instanceof Blob) {
          ev.data.text().then(handleMessage);
        }
      };

      ws.onerror = () => {
        didError = true;
        const msg = 'WebSocket 연결 오류 — API 키 및 네트워크를 확인하세요';
        console.error('[GeminiLive]', msg);
        setError(msg);
        setState('error');
      };

      ws.onclose = (ev) => {
        wsRef.current = null;
        if (!didError) {
          setState('disconnected');
          console.log('[GeminiLive] 연결 종료:', ev.code, ev.reason || '정상 종료');
        }
      };
    },
    [getCtx, handleMessage]
  );

  // ── 오디오 청크 전송 ─────────────────────────────────────────
  // VAD onSpeechEnd 콜백에서 chunk.base64를 그대로 전달
  //
  // 사용 예:
  //   audioRouter.startVADWeb('sys', {
  //     onSpeechEnd: (chunk) => sendAudioChunk(chunk.base64),
  //   }, { muteUntilRef })
  const sendAudioChunk = useCallback((base64: string, inputSampleRate?: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const rate = inputSampleRate ?? configRef.current?.inputSampleRate ?? 16000;
    ws.send(
      JSON.stringify({
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: `audio/pcm;rate=${rate}`,
              data: base64,
            },
          ],
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
    wsRef.current?.close(1000, 'user disconnect');
    wsRef.current = null;
    nextPlayTimeRef.current = 0;
    nextVbPlayTimeRef.current = 0;
    muteUntilRef.current = 0;
    subtitleAccRef.current = '';
    setState('disconnected');
  }, []);

  // ── 자막 콜백 등록/해제 ──────────────────────────────────────
  const setSubtitleCallback = useCallback((cb: ((text: string) => void) | null) => {
    onSubtitleRef.current = cb;
  }, []);

  // ── 언마운트 정리 ────────────────────────────────────────────
  useEffect(() => {
    return () => {
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
  };
}
