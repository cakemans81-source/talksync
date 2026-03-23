'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import { GeminiSTTManager, type STTLanguage } from '@/lib/stt';
import { translateTextStream, langCodeToName } from '@/lib/gemini';
import {
  synthesizeEdgeTTS, defaultEdgeVoiceForLang, stopTTS, speakBrowserTTS,
  synthesizeElevenLabsTTS, synthesizeGeminiTTS,
  type TTSEngine,
} from '@/lib/tts';
import { useAudioRouter } from './useAudioRouter';

// ─────────────────────────────────────────────
// 초저지연 파이프라인 설계
//
//  STT interim → 자막만 즉시 표시 (번역 없음)
//  STT isFinal → translateTextStream() 스트리밍 번역 → 번역 자막 실시간 업데이트
//             → 번역 완료 → TTS 합성 → 오디오 라우팅
//  VAD 침묵 감지 → pending interim 강제 번역 (isFinal 지연 백업)
//  번역 큐 → 동시 번역 방지, TTS 겹침 방지
//
//  예상 딜레이: ~200ms(STT) + ~400ms(Gemini) + ~300ms(TTS) ≈ <1s
// ─────────────────────────────────────────────

export type Transcript = {
  id: string;
  source: 'mic' | 'sys';
  original: string;
  translated: string;
  isStreaming?: boolean;
  timestamp: number;
};

export type PipelineState = 'idle' | 'starting' | 'running' | 'error';

export type PipelineConfig = {
  micLang: STTLanguage;
  sysLang: STTLanguage;
  apiKey: string;
  micDeviceId?: string;
  virtualMicDeviceId?: string;
  earphoneDeviceId?: string;
  ttsVoice?: string;        // 선택된 엔진의 voice ID
  ttsRate?: number;         // 말하기 속도 (0.5~2.0, 기본 1.0) — Edge TTS 전용
  ttsEngine?: TTSEngine;    // 'edge' | 'elevenlabs' | 'gemini' (기본: 'edge')
  elevenLabsApiKey?: string; // ElevenLabs 전용 API 키
};

type TranslationJob = { source: 'mic' | 'sys'; text: string; config: PipelineConfig };

export function useTranslationPipeline() {
  const audioRouter = useAudioRouter();
  const sttManagerRef = useRef<GeminiSTTManager | null>(null);

  const [state, setState] = useState<PipelineState>('idle');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [interimMic, setInterimMic] = useState('');
  const [interimSys, setInterimSys] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ttsWarning, setTtsWarning] = useState<string | null>(null);

  const queueRef = useRef<TranslationJob[]>([]);
  const isProcessingRef = useRef(false);
  const vadCleanupRef = useRef<Array<() => void>>([]);
  const pendingMicRef = useRef('');
  const pendingSysRef = useRef('');
  // 현재 번역·TTS 처리 중인 텍스트 (소스별) — 중복 enqueue 방지
  const inFlightRef = useRef<{ mic: string; sys: string }>({ mic: '', sys: '' });
  // TTS 재생 중 sys STT 피드백 루프 방지 — TTS 음성이 시스템 오디오로 재캡처되는 것 차단
  const sysMuteUntilRef = useRef<number>(0);

  // ── 번역 큐 처리 ────────────────────────────
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current || queueRef.current.length === 0) return;
    isProcessingRef.current = true;

    const { source, text, config } = queueRef.current.shift()!;
    inFlightRef.current[source] = text; // 처리 시작 — 같은 텍스트 재진입 차단

    const fromLang = source === 'mic' ? langCodeToName(config.micLang) : langCodeToName(config.sysLang);
    const toLang   = source === 'mic' ? langCodeToName(config.sysLang) : langCodeToName(config.micLang);
    const ttsLang  = source === 'mic' ? config.sysLang : config.micLang;

    const id = `${Date.now()}-${Math.random()}`;
    let accumulated = '';

    try {
      // 스트리밍 번역 시작 — 빈 항목 먼저 추가
      setTranscripts((prev) => [
        ...prev.slice(-49),
        { id, source, original: text, translated: '', isStreaming: true, timestamp: Date.now() },
      ]);

      // 청크 단위로 번역 수신 → 자막 실시간 업데이트
      for await (const chunk of translateTextStream(text, fromLang, toLang, config.apiKey)) {
        accumulated += chunk;
        setTranscripts((prev) =>
          prev.map((t) => t.id === id ? { ...t, translated: accumulated } : t)
        );
      }

      setTranscripts((prev) =>
        prev.map((t) => t.id === id ? { ...t, isStreaming: false } : t)
      );

      if (!accumulated.trim()) return;

      // ── 통합 TTS 합성 (선택 엔진 → Edge TTS 폴백 → 브라우저 TTS 최종 폴백) ──
      const engine  = config.ttsEngine ?? 'edge';
      const rate    = config.ttsRate ?? 1.0;
      const edgeFallbackVoice = defaultEdgeVoiceForLang(ttsLang);

      let audioBuffer: ArrayBuffer | null = null;
      let usedBrowserFallback = false;

      // 1차: 선택된 엔진 시도
      try {
        if (engine === 'elevenlabs') {
          if (!config.elevenLabsApiKey) throw new Error('ElevenLabs API 키 없음');
          audioBuffer = await synthesizeElevenLabsTTS(
            accumulated,
            config.ttsVoice ?? '21m00Tcm4TlvDq8ikWAM',
            config.elevenLabsApiKey
          );
        } else if (engine === 'gemini') {
          audioBuffer = await synthesizeGeminiTTS(
            accumulated,
            config.ttsVoice ?? 'Aoede',
            config.apiKey
          );
        } else {
          audioBuffer = await synthesizeEdgeTTS(
            accumulated,
            config.ttsVoice ?? edgeFallbackVoice,
            rate
          );
        }
      } catch (primaryErr) {
        const reason = (primaryErr as Error).message?.slice(0, 80) ?? String(primaryErr);
        const warn = `${engine === 'elevenlabs' ? 'ElevenLabs' : 'Gemini'} TTS 실패 → Edge TTS로 자동 전환 (${reason})`;
        console.warn('[TTS Fallback]', warn);
        setTtsWarning(warn);

        // 2차: Edge TTS 폴백
        try {
          audioBuffer = await synthesizeEdgeTTS(accumulated, edgeFallbackVoice, rate);
        } catch (edgeErr) {
          console.warn('[TTS Fallback] Edge TTS도 실패 → 브라우저 TTS 최종 폴백:', edgeErr);
          audioBuffer = null;
        }
      }

      if (audioBuffer) {
        // MP3/WAV 크기로 재생 시간 추정 (48kbps → ~6KB/s) + 5초 여유
        const estimatedDurationMs = (audioBuffer.byteLength / 6000) * 1000 + 5000;
        sysMuteUntilRef.current = Date.now() + estimatedDurationMs;

        if (source === 'mic') {
          // 내 번역음 → VB-Cable → Discord 상대방 마이크로 전달
          await audioRouter.routeMP3ToVirtualMic(audioBuffer);
          // TTS 완료 후 추가 5초 뮤트 — STT 에코 차단
          sysMuteUntilRef.current = Date.now() + 5000;
        } else {
          // 상대방 번역음 → 이어폰으로 출력 (setSinkId 적용)
          await audioRouter.playBlobToEarphone(new Blob([audioBuffer], { type: 'audio/mp3' }));
        }
      } else {
        // 3차(최종): 브라우저 내장 TTS — VB-Cable 라우팅 불가, 이어폰만 출력
        usedBrowserFallback = true;
        const estimatedTtsDurationMs = Math.max(accumulated.length * 80, 3000);
        sysMuteUntilRef.current = Date.now() + estimatedTtsDurationMs + 6000;
        speakBrowserTTS(accumulated, ttsLang, rate);
      }
      void usedBrowserFallback; // 추후 UI 상태 표시용

      if (source === 'mic') setInterimMic('');
      else setInterimSys('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '번역 오류');
    } finally {
      inFlightRef.current[source] = ''; // 처리 완료 — 다음 텍스트 허용
      isProcessingRef.current = false;
      processQueue(); // 다음 항목
    }
  }, [audioRouter]);

  const enqueue = useCallback(
    (source: 'mic' | 'sys', text: string, config: PipelineConfig) => {
      if (!text.trim()) return;

      // TTS 피드백 루프 차단: TTS 재생 직후 sys 음성은 TTS 에코일 가능성이 높음
      if (source === 'sys' && Date.now() < sysMuteUntilRef.current) return;

      // 현재 처리 중인 텍스트와 동일하면 무시 (VAD + isFinal 이중 트리거 방지)
      if (inFlightRef.current[source] === text) return;

      // 같은 소스의 대기 항목 교체 (최신 발화로 덮어쓰기)
      const i = queueRef.current.findIndex((j) => j.source === source);
      if (i >= 0) queueRef.current[i] = { source, text, config };
      else queueRef.current.push({ source, text, config });
      processQueue();
    },
    [processQueue]
  );

  // ── 시작 ────────────────────────────────────
  const start = useCallback(
    async (config: PipelineConfig) => {
      try {
        setState('starting');
        setError(null);

        if (config.micDeviceId) await audioRouter.setMicDevice(config.micDeviceId);
        if (config.virtualMicDeviceId) await audioRouter.setVirtualMicDevice(config.virtualMicDeviceId);
        if (config.earphoneDeviceId) await audioRouter.setEarphoneDevice(config.earphoneDeviceId);

        await audioRouter.captureMic();
        try {
          await audioRouter.captureSystemAudio();
        } catch (sysErr) {
          // 시스템 오디오 캡처 실패 시 경고만 출력하고 계속 진행 (마이크 통역은 동작)
          console.warn('[Pipeline] 시스템 오디오 캡처 실패 (상대방 번역 비활성화):', sysErr);
        }
        await audioRouter.startVirtualMicPlayback(); // VB-Cable 스트리밍 시작

        // VAD 백업: isFinal 지연 시 침묵 감지로 번역 트리거
        const stopMicVAD = audioRouter.startVAD('mic', () => {
          if (pendingMicRef.current.trim()) {
            enqueue('mic', pendingMicRef.current, config);
            pendingMicRef.current = '';
          }
        });
        const stopSysVAD = audioRouter.startVAD('sys', () => {
          if (pendingSysRef.current.trim()) {
            enqueue('sys', pendingSysRef.current, config);
            pendingSysRef.current = '';
          }
        });
        vadCleanupRef.current = [stopMicVAD, stopSysVAD];

        sttManagerRef.current = new GeminiSTTManager(
          audioRouter.getMicStream(),
          audioRouter.getSysStream(),
          config.micLang,
          config.sysLang,
          config.apiKey,
          (text) => { pendingMicRef.current = ''; enqueue('mic', text, config); },
          (text) => { pendingSysRef.current = ''; enqueue('sys', text, config); },
          (text) => {
            setInterimMic(text);
            // '인식 중...'은 UI 표시용 — pendingMicRef(번역 대기 텍스트)에는 저장 안 함
            if (text && text !== '인식 중...') pendingMicRef.current = text;
            else if (!text) pendingMicRef.current = ''; // 빈 문자열로 클리어
          },
          (src, err) => setError(`STT 오류(${src}): ${err}`)
        );
        sttManagerRef.current.start();

        setState('running');
      } catch (err) {
        setError(err instanceof Error ? err.message : '시작 실패');
        setState('error');
      }
    },
    [audioRouter, enqueue]
  );

  // ── 중지 ────────────────────────────────────
  const stop = useCallback(() => {
    stopTTS();
    audioRouter.stopAllTTS(); // 재생 중인 TTS 즉시 중단
    sttManagerRef.current?.stop();
    sttManagerRef.current = null;
    vadCleanupRef.current.forEach((fn) => fn());
    vadCleanupRef.current = [];
    queueRef.current = [];
    isProcessingRef.current = false;
    inFlightRef.current = { mic: '', sys: '' };
    pendingMicRef.current = '';
    pendingSysRef.current = '';
    setInterimMic('');
    setInterimSys('');
    setState('idle');
  }, [audioRouter]);

  const clearTranscripts = useCallback(() => setTranscripts([]), []);

  // ttsWarning 자동 소거 — 4초 후 토스트 사라짐
  useEffect(() => {
    if (!ttsWarning) return;
    const t = setTimeout(() => setTtsWarning(null), 4000);
    return () => clearTimeout(t);
  }, [ttsWarning]);

  // 컴포넌트 언마운트 시에만 실행 — audioRouter를 dep에 넣으면 매 렌더마다
  // cleanup이 실행돼서 STT가 즉시 중단되는 버그 발생 (audioRouter는 매 렌더 새 객체)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    sttManagerRef.current?.stop();
    vadCleanupRef.current.forEach((fn) => fn());
    stopTTS();
    audioRouter.stopAllTTS();
  }, []);

  return {
    state, transcripts, interimMic, interimSys, error, ttsWarning,
    start, stop, clearTranscripts,
    devices: audioRouter.devices,
    refreshDevices: audioRouter.refreshDevices,
    setMicDevice: audioRouter.setMicDevice,
    setVirtualMicDevice: audioRouter.setVirtualMicDevice,
    setEarphoneDevice: audioRouter.setEarphoneDevice,
    getMicLevel: audioRouter.getMicLevel,
    getSysLevel: audioRouter.getSysLevel,
    // V2 Gemini Live 파이프라인 연동용 — 별도 오디오 캡처 및 Silero VAD 연결
    captureMic: audioRouter.captureMic,
    captureSystemAudio: audioRouter.captureSystemAudio,
    startVADWeb: audioRouter.startVADWeb,
    playBlobToEarphone: audioRouter.playBlobToEarphone,
    get isMicActive() { return audioRouter.isMicActive; },
    get isSysActive() { return audioRouter.isSysActive; },
  };
}
