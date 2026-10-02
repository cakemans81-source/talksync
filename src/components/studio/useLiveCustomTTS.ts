'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchElevenLabsVoices,
  synthesizeEdgeTTS, synthesizeElevenLabsTTS, synthesizeGeminiTTS, defaultEdgeVoiceForLang,
  type TTSEngine,
} from '@/lib/tts';
import type { STTLanguage } from '@/lib/stt';
import { DEFAULT_TTS_VOICES } from './constants';

// ─────────────────────────────────────────────
// Gemini Live 프리미엄(커스텀 TTS) 모드
// TTS 엔진·음성 선택 UI는 없음 — localStorage/userSettings에서 복원된 값으로
// 커스텀 TTS 콜백이 합성 후 이어폰으로 재생한다.
// ─────────────────────────────────────────────
export function useLiveCustomTTS({
  micLang, apiKey, setMuteUntil, playBlobToEarphone,
}: {
  micLang: string;
  apiKey: string;
  /** useGeminiLive().setMuteUntil — 안정적인 useCallback */
  setMuteUntil: (ms: number) => void;
  /** useAudioRouter().playBlobToEarphone — 안정적인 useCallback */
  playBlobToEarphone: (blob: Blob) => Promise<void>;
}) {
  const [ttsEngine, setTtsEngine] = useState<TTSEngine>('edge');
  const [ttsVoice, setTtsVoice] = useState('ko-KR-SunHiNeural'); // localStorage에서 복원
  const [ttsRate, setTtsRate] = useState(1.0);       // 말하기 속도 — localStorage에서 복원
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');  // ElevenLabs API 키
  // TTS 출력 모드: false = 초저지연(Gemini PCM), true = 프리미엄(커스텀 TTS)
  const [liveCustomTTS, setLiveCustomTTSState] = useState(false);

  // ── ElevenLabs 동적 보이스 패치 상태 ──────────
  const [elVoicesError, setElVoicesError] = useState<string | null>(null);
  const elFetchedKeyRef = useRef<string>(''); // 중복 패치 방지

  // 커스텀 TTS 콜백에서 최신 TTS 파라미터를 읽기 위한 Ref (stale closure 방지)
  const liveCustomTTSParamsRef = useRef({ ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang });
  // 커스텀 TTS 콜백 Ref — 항상 최신 paramsRef를 통해 읽음
  const liveCustomTTSCallbackRef = useRef<(text: string) => void>(() => {});

  // ── TTS 엔진·음성·속도 설정 복원 ──────────────
  useEffect(() => {
    const savedEngine = (localStorage.getItem('ttsEngine') ?? 'edge') as TTSEngine;
    setTtsEngine(savedEngine);

    const savedVoice = localStorage.getItem(`ttsVoice_${savedEngine}`);
    setTtsVoice(savedVoice ?? DEFAULT_TTS_VOICES[savedEngine]);

    const savedRate = parseFloat(localStorage.getItem('ttsRate') ?? '');
    if (!isNaN(savedRate) && savedRate >= 0.5 && savedRate <= 2.0) setTtsRate(savedRate);

    if (localStorage.getItem('liveCustomTTS') === '1') setLiveCustomTTSState(true);

    // ElevenLabs 키는 userId 확정 후 loadUserSettings()에서 로드 (StudioPage 인증 useEffect)
  }, []);

  // ── 커스텀 TTS 파라미터 Ref 동기화 ───────────
  useEffect(() => {
    liveCustomTTSParamsRef.current = { ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang };
  }, [ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang]);

  // ── 커스텀 TTS 콜백 초기화 (마운트 시 1회 — deps는 안정적인 useCallback) ────
  // 항상 liveCustomTTSParamsRef.current에서 최신 파라미터를 읽으므로 stale closure 없음
  useEffect(() => {
    liveCustomTTSCallbackRef.current = async (text: string) => {
      if (!text.trim()) return;
      const { ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang } = liveCustomTTSParamsRef.current;

      let audioBuffer: ArrayBuffer | null = null;
      try {
        if (ttsEngine === 'elevenlabs') {
          if (!elevenLabsApiKey) throw new Error('ElevenLabs API 키 없음');
          audioBuffer = await synthesizeElevenLabsTTS(text, ttsVoice, elevenLabsApiKey);
        } else if (ttsEngine === 'gemini') {
          audioBuffer = await synthesizeGeminiTTS(text, ttsVoice, apiKey);
        } else {
          audioBuffer = await synthesizeEdgeTTS(text, ttsVoice, ttsRate);
        }
      } catch (primaryErr) {
        console.warn('[Live Custom TTS] 1차 합성 실패:', primaryErr);
        try {
          const fallbackVoice = defaultEdgeVoiceForLang(micLang as STTLanguage);
          audioBuffer = await synthesizeEdgeTTS(text, fallbackVoice, ttsRate);
        } catch { /* Edge TTS도 실패 — 무음으로 진행 */ }
      }

      if (audioBuffer) {
        const estimatedMs = (audioBuffer.byteLength / 6000) * 1000 + 5000;
        setMuteUntil(Date.now() + estimatedMs);
        await playBlobToEarphone(new Blob([audioBuffer], { type: 'audio/mp3' }));
        setMuteUntil(Date.now() + 5000); // 재생 후 5초 추가 뮤트
      }
    };
  }, [setMuteUntil, playBlobToEarphone]);

  // ── ElevenLabs 보이스 동적 패치 ──────────────
  // 조건: ElevenLabs 엔진(저장값) + 유효한 API 키
  // 동일 키로 중복 패치 방지 (elFetchedKeyRef)
  // 저장된 voice_id가 계정 목록에 없으면 첫 항목으로 리셋 + 실패 시 에러 토스트
  useEffect(() => {
    if (ttsEngine !== 'elevenlabs' || !elevenLabsApiKey.trim()) return;
    if (elFetchedKeyRef.current === elevenLabsApiKey) return; // 이미 패치한 키

    let cancelled = false;
    setElVoicesError(null);

    fetchElevenLabsVoices(elevenLabsApiKey)
      .then((voices) => {
        if (cancelled) return;
        elFetchedKeyRef.current = elevenLabsApiKey;
        // 현재 선택된 voice_id가 새 목록에 없으면 첫 번째 항목으로 리셋
        // ttsVoice는 패치 트리거가 아니므로 deps 대신 paramsRef에서 최신값을 읽음
        const voiceIds = voices.map((v) => v.voice_id);
        if (voiceIds.length > 0 && !voiceIds.includes(liveCustomTTSParamsRef.current.ttsVoice)) {
          setTtsVoice(voiceIds[0]);
          localStorage.setItem('ttsVoice_elevenlabs', voiceIds[0]);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setElVoicesError(`ElevenLabs 보이스 로드 실패: ${err.message}`);
      });

    return () => { cancelled = true; };
  }, [ttsEngine, elevenLabsApiKey]);

  // TTS 출력 모드 저장 (localStorage)
  const setLiveCustomTTS = useCallback((enabled: boolean) => {
    setLiveCustomTTSState(enabled);
    localStorage.setItem('liveCustomTTS', enabled ? '1' : '0');
  }, []);

  // 로그아웃 시 ElevenLabs 상태 초기화 — 다음 사용자가 볼 수 없도록
  const resetElevenLabs = useCallback(() => {
    setElevenLabsApiKey('');
    elFetchedKeyRef.current = ''; // 다음 로그인 시 새 키로 재패치 허용
  }, []);

  return {
    liveCustomTTS,
    setLiveCustomTTS,
    /** Gemini Live enableCustomTTS()에 전달할 콜백 Ref */
    liveCustomTTSCallbackRef,
    elVoicesError,
    setElevenLabsApiKey,
    resetElevenLabs,
  };
}
