'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { useAudioRouter } from '@/hooks/useAudioRouter';
import { useBrowserTabAudioCapture } from '@/hooks/useBrowserTabAudioCapture';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { SUPPORTED_LANGUAGES } from '@/lib/stt';
import {
  GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE,
  toGeminiLiveTranslateLanguageCode,
} from '@/lib/geminiModels';
import type { BrowserTabLiveTranslateState } from '@/components/audio/BrowserTabTranslatePanel';
import { VAD_SPEED_PRESETS, type VADSpeed } from './constants';
import { buildBrowserTabRxInstruction } from './liveInstructions';

type StartVADWeb = ReturnType<typeof useAudioRouter>['startVADWeb'];

// ─────────────────────────────────────────────
// Browser Tab Live Translate Rx — 탭/창 오디오 캡처 + 전용 Gemini Live 세션
// (양방향 Live Translate와 별도 세션 — 동시 실행 불가)
// ─────────────────────────────────────────────
export function useBrowserTabRx({
  startVADWeb, vadSpeed, onSubtitle, onSessionStart, onMissingApiKey,
}: {
  /** useAudioRouter().startVADWeb — 안정적인 useCallback */
  startVADWeb: StartVADWeb;
  vadSpeed: VADSpeed;
  /** 자막 콜백 — 안정적인 함수여야 함 (마운트 시 1회 등록) */
  onSubtitle: (text: string) => void;
  /** 통역 시작 직전 호출 (자막 초기화) */
  onSessionStart: () => void;
  onMissingApiKey: () => void;
}) {
  const browserTabAudio = useBrowserTabAudioCapture();
  const browserTabGeminiLive = useGeminiLive();
  // useGeminiLive는 매 렌더 새 객체를 반환하므로 deps에는 안정적인 useCallback 멤버만 사용
  const {
    disconnect: disconnectBrowserTabLive,
    disableCustomTTS: disableBrowserTabCustomTTS,
    sendAudioChunk: sendBrowserTabAudioChunk,
    setSubtitleCallback: setBrowserTabSubtitleCallback,
  } = browserTabGeminiLive;

  const [browserTabRxState, setBrowserTabRxState] = useState<BrowserTabLiveTranslateState>('idle');
  const [browserTabRxError, setBrowserTabRxError] = useState<string | null>(null);
  const stopBrowserTabRxVADRef = useRef<(() => void) | null>(null);
  const browserTabRxStartedRef = useRef(false);
  const browserTabRxWasReadyRef = useRef(false);

  // ── Browser Tab Rx 자막 콜백 등록 ─────────────────────────────
  useEffect(() => {
    setBrowserTabSubtitleCallback(onSubtitle);
  }, [setBrowserTabSubtitleCallback, onSubtitle]);

  const stopBrowserTabTranslate = useCallback((
    message?: string,
    nextState: BrowserTabLiveTranslateState = 'stopped'
  ) => {
    browserTabRxStartedRef.current = false;
    browserTabRxWasReadyRef.current = false;
    setBrowserTabRxState(nextState === 'error' ? 'error' : 'stopping');

    stopBrowserTabRxVADRef.current?.();
    stopBrowserTabRxVADRef.current = null;
    disconnectBrowserTabLive();
    disableBrowserTabCustomTTS();

    setBrowserTabRxState(nextState);
    setBrowserTabRxError(message ?? null);
  }, [disconnectBrowserTabLive, disableBrowserTabCustomTTS]);

  const startBrowserTabRxVAD = useCallback(async () => {
    if (stopBrowserTabRxVADRef.current) return;

    const audioTrack = browserTabAudio.audioTrack;
    if (!audioTrack || audioTrack.readyState !== 'live') {
      setBrowserTabRxState('error');
      setBrowserTabRxError('오디오 track이 없습니다. 공유 창에서 오디오 공유를 켜 주세요.');
      disconnectBrowserTabLive();
      browserTabRxStartedRef.current = false;
      return;
    }

    const audioOnlyStream = new MediaStream([audioTrack]);
    stopBrowserTabRxVADRef.current = () => {};

    try {
      const cleanup = await startVADWeb(
        audioOnlyStream,
        {
          onSpeechStart: () => {
            setBrowserTabRxState('translating');
            setBrowserTabRxError(null);
          },
          onSpeechFrame: (base64) => {
            sendBrowserTabAudioChunk(base64);
          },
          onSpeechEnd: () => {
            setBrowserTabRxState('translating');
          },
          onVADFallback: (reason) => {
            setBrowserTabRxError(`VAD 초기화 실패 (${reason}) — RMS 폴백으로 동작 중`);
          },
        },
        // Browser Tab capture is already isolated from local speaker playback.
        // Keep the Full Voice AEC mute gate out of this path so translated audio
        // playback does not suppress the selected tab's incoming speech. Also
        // stream non-silent tab frames continuously instead of relying on speech
        // boundary detection, which can be unstable for captured media audio.
        { ...VAD_SPEED_PRESETS[vadSpeed], streamMode: 'continuous' }
      );
      stopBrowserTabRxVADRef.current = cleanup;
      setBrowserTabRxState('translating');
    } catch (err) {
      stopBrowserTabRxVADRef.current = null;
      browserTabRxStartedRef.current = false;
      disconnectBrowserTabLive();
      setBrowserTabRxState('error');
      setBrowserTabRxError(err instanceof Error ? `VAD 시작 실패: ${err.message}` : 'VAD 시작 실패');
    }
  }, [browserTabAudio.audioTrack, disconnectBrowserTabLive, sendBrowserTabAudioChunk, startVADWeb, vadSpeed]);

  useEffect(() => {
    if (!browserTabRxStartedRef.current) return;

    if (browserTabGeminiLive.state === 'ready' && !stopBrowserTabRxVADRef.current) {
      browserTabRxWasReadyRef.current = true;
      // 외부 시스템(Gemini WS) 상태 전이에 반응해 VAD를 붙이는 effect — track 없음 분기에서 동기 setState 발생
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void startBrowserTabRxVAD();
    }

    if (browserTabGeminiLive.state === 'error') {
      const msg = browserTabGeminiLive.error ?? GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE;
      browserTabRxStartedRef.current = false;
      browserTabRxWasReadyRef.current = false;
      stopBrowserTabRxVADRef.current?.();
      stopBrowserTabRxVADRef.current = null;
      // 방어적 정리: 훅에 남은 소켓/재연결 타이머가 고아 세션을 만들지 않도록 명시적으로 끊는다
      // (disconnect → state 'disconnected'로 이 effect가 재실행돼도 startedRef=false라 무시됨)
      disconnectBrowserTabLive();
      setBrowserTabRxState('error');
      setBrowserTabRxError(msg);
    }

    if (browserTabGeminiLive.state === 'disconnected' && browserTabRxWasReadyRef.current) {
      browserTabRxStartedRef.current = false;
      browserTabRxWasReadyRef.current = false;
      stopBrowserTabRxVADRef.current?.();
      stopBrowserTabRxVADRef.current = null;
      setBrowserTabRxState('stopped');
      setBrowserTabRxError('Gemini Live Translate 연결이 종료되었습니다.');
    }
  }, [browserTabGeminiLive.state, browserTabGeminiLive.error, startBrowserTabRxVAD, disconnectBrowserTabLive]);

  useEffect(() => {
    if (!browserTabRxStartedRef.current) return;
    if (browserTabAudio.state !== 'sharing' || !browserTabAudio.hasAudioTrack) {
      // 외부 공유 종료(사용자가 브라우저 공유 중지)에 반응해 세션을 정리하는 effect
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stopBrowserTabTranslate('공유가 중단되어 Browser Tab Live Translate를 정리했습니다.', 'stopped');
    }
  }, [browserTabAudio.state, browserTabAudio.hasAudioTrack, stopBrowserTabTranslate]);

  // 언마운트 시 정리 (disconnect는 안정적인 useCallback → 마운트 시 1회)
  useEffect(() => () => {
    stopBrowserTabRxVADRef.current?.();
    stopBrowserTabRxVADRef.current = null;
    disconnectBrowserTabLive();
  }, [disconnectBrowserTabLive]);

  async function start({
    apiKey, liveActive, micLang, liveVoice, earphoneDeviceId,
  }: {
    apiKey: string;
    liveActive: boolean;
    micLang: string;
    liveVoice: string;
    earphoneDeviceId: string;
  }) {
    if (!apiKey) {
      setBrowserTabRxError('Gemini API 키를 먼저 설정해 주세요.');
      onMissingApiKey();
      return;
    }

    if (liveActive) {
      setBrowserTabRxError('양방향 Live Translate가 실행 중입니다. 먼저 중지한 뒤 Browser Tab 통역을 시작해 주세요.');
      return;
    }

    const audioTrack = browserTabAudio.audioTrack;
    if (browserTabAudio.state !== 'sharing' || !browserTabAudio.stream || !audioTrack || audioTrack.readyState !== 'live') {
      setBrowserTabRxState('error');
      setBrowserTabRxError('오디오 track이 없습니다. 먼저 브라우저/탭 오디오를 공유해 주세요.');
      return;
    }

    stopBrowserTabRxVADRef.current?.();
    stopBrowserTabRxVADRef.current = null;
    browserTabRxStartedRef.current = true;
    browserTabRxWasReadyRef.current = false;
    setBrowserTabRxState('connecting');
    setBrowserTabRxError(null);
    onSessionStart();
    browserTabGeminiLive.disableCustomTTS();

    const targetLangLabel = SUPPORTED_LANGUAGES.find((l) => l.code === micLang)?.label ?? micLang;
    const targetLanguageCode = toGeminiLiveTranslateLanguageCode(micLang);
    const systemInstruction = buildBrowserTabRxInstruction(targetLangLabel, targetLanguageCode);

    try {
      await browserTabGeminiLive.connect({
        apiKey,
        voiceName: liveVoice,
        outputDeviceId: earphoneDeviceId,
        inputSampleRate: 16000,
        translationTargetLanguageCode: targetLanguageCode,
        systemInstruction,
      });
    } catch (err) {
      browserTabRxStartedRef.current = false;
      browserTabRxWasReadyRef.current = false;
      setBrowserTabRxState('error');
      setBrowserTabRxError(err instanceof Error ? `연결 실패: ${err.message}` : '연결 실패');
    }
  }

  const panelLiveState: BrowserTabLiveTranslateState =
    browserTabRxState === 'idle' && browserTabAudio.hasAudioTrack
      ? 'captured'
      : browserTabRxState;

  return {
    audio: browserTabAudio,
    panelLiveState,
    error: browserTabRxError,
    /** 클릭 시점 확인용 (양방향 Live Translate와 동시 실행 방지) */
    isRunning: () => browserTabRxStartedRef.current,
    start,
    stop: () => stopBrowserTabTranslate(undefined, 'stopped'),
    startCapture: () => {
      setBrowserTabRxState('idle');
      setBrowserTabRxError(null);
      void browserTabAudio.startCapture();
    },
    stopCapture: () => {
      stopBrowserTabTranslate(undefined, 'stopped');
      browserTabAudio.stopCapture();
    },
  };
}
