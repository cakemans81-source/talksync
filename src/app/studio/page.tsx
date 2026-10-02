'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAudioRouter } from '@/hooks/useAudioRouter';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { SUPPORTED_LANGUAGES } from '@/lib/stt';
import { decryptApiKey, cacheApiKeyInSession, getCachedApiKey, clearCachedApiKey, saveKeyLocally, loadKeyLocally } from '@/lib/crypto';
import { getSupabaseClient, getCurrentUser, loadEncryptedKey } from '@/lib/supabase';
import { loadUserSettings } from '@/lib/userSettings';
import { BrowserTabTranslatePanel } from '@/components/audio/BrowserTabTranslatePanel';
import { useAutoAudioSetup } from '@/hooks/useAutoAudioSetup';
import {
  evaluateIsolationHardGate,
  isolationGateDisabledReason,
} from '@/lib/isolationHardGate';
import { GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE } from '@/lib/geminiModels';
import { ApiKeyModal } from '@/components/studio/ApiKeyModal';
import { AudioSetupPanel } from '@/components/studio/AudioSetupPanel';
import {
  ENABLE_BROWSER_TAB_CAPTURE_WEB_DEV,
  VAD_SPEED_PRESETS,
  type LiveSubtitle,
  type VADSpeed,
} from '@/components/studio/constants';
import { DriverNotice } from '@/components/studio/DriverNotice';
import { extractTranslation } from '@/components/studio/extractTranslation';
import { GeminiLivePanel, type LivePhase } from '@/components/studio/GeminiLivePanel';
import { IsolationChecklist } from '@/components/studio/IsolationChecklist';
import { MicLevelMeter } from '@/components/studio/LevelBar';
import { buildBidirectionalInstruction } from '@/components/studio/liveInstructions';
import { ManualDeviceSelectors } from '@/components/studio/ManualDeviceSelectors';
import { StudioHeader } from '@/components/studio/StudioHeader';
import { SubtitleFeed, UsageGuide } from '@/components/studio/SubtitleFeed';
import { useBrowserTabRx } from '@/components/studio/useBrowserTabRx';
import { useLiveCustomTTS } from '@/components/studio/useLiveCustomTTS';
import { useVirtualCableCheck } from '@/components/studio/useVirtualCableCheck';
import { WebOnlyFallback } from '@/components/studio/WebOnlyFallback';

// ─────────────────────────────────────────────
// 메인 Studio 페이지
// ─────────────────────────────────────────────
export default function StudioPage() {
  const router = useRouter();
  const pipeline = useAudioRouter();
  // useAudioRouter / useGeminiLive는 매 렌더 새 객체를 반환하므로 deps에는 안정적인 useCallback 멤버만 사용
  // (pipeline.isMicActive / isSysActive는 getter — 호출 시점에 직접 읽음)
  const { getMicLevel, startVADWeb, playBlobToEarphone, setMicDevice, setVirtualMicDevice, setEarphoneDevice } = pipeline;
  const geminiLive = useGeminiLive();
  const { setMuteUntil, setSubtitleCallback: setLiveSubtitleCallback } = geminiLive;
  const autoAudio = useAutoAudioSetup();
  const subtitleEndRef = useRef<HTMLDivElement>(null);

  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiModal, setShowApiModal] = useState(false);
  const [virtualCableReady, setVirtualCableReady] = useVirtualCableCheck(); // null = 검사 전
  // Electron 여부 — 마운트 후 감지 (SSR hydration mismatch 방지)
  const [isElectron, setIsElectron] = useState<boolean | null>(null);

  const [micLang, setMicLang] = useState('ko-KR');
  const [sysLang, setSysLang] = useState('en-US');
  const [micDeviceId, setMicDeviceId] = useState('default');
  const [virtualMicDeviceId, setVirtualMicDeviceId] = useState('default');
  const [earphoneDeviceId, setEarphoneDeviceId] = useState('default');
  const [cableDetected, setCableDetected] = useState(false);
  const [vadSpeed, setVadSpeed] = useState<VADSpeed>('balanced');

  // ── Gemini Live Translate V2 파이프라인 상태 ────────────
  const [liveActive, setLiveActive] = useState(false);
  const [liveVoice, setLiveVoice] = useState('Aoede');
  const [liveToast, setLiveToast] = useState<string | null>(null);
  // VAD 발화 감지 중 (onSpeechStart → onSpeechEnd 구간)
  const [isVADProcessing, setIsVADProcessing] = useState(false);
  // Gemini 응답 오디오 재생 중 (muteUntilRef 폴링으로 감지)
  const [isSpeakingLive, setIsSpeakingLive] = useState(false);
  // VAD 정리 함수 ref
  const stopLiveVADRef = useRef<(() => void) | null>(null);
  // 시스템 오디오(상대방 음성) VAD 정리 함수 ref
  const stopLiveSysVADRef = useRef<(() => void) | null>(null);
  // 'ready' 상태가 되면 VAD를 한 번만 시작하기 위한 플래그
  const liveStartedRef = useRef(false);
  // 최초 'ready' 도달 여부 — setLiveActive(true) 리렌더링 시 state='disconnected'에서
  // useEffect cleanup 분기가 조기 실행되는 것을 방지하는 핵심 가드
  const liveWasReadyRef = useRef(false);
  // V2 실시간 자막 (turnComplete 시 Gemini 텍스트 파트 수집)
  const [liveSubtitles, setLiveSubtitles] = useState<LiveSubtitle[]>([]);
  // 자막 콜백(마운트 시 1회 등록)에서 최신 언어를 읽기 위한 Ref
  const micLangRef = useRef(micLang);

  // 프리미엄(커스텀 TTS) 모드 — TTS 설정 복원 + ElevenLabs 보이스 검증 + 합성 콜백
  const customTTS = useLiveCustomTTS({ micLang, apiKey, setMuteUntil, playBlobToEarphone });
  const { liveCustomTTS, liveCustomTTSCallbackRef, setElevenLabsApiKey } = customTTS;

  const openApiKeyModal = useCallback(() => {
    setShowApiModal(true);

    if (userId) return;

    void getCurrentUser()
      .then((user) => {
        if (user) {
          setUserId(user.id);
          return;
        }
        router.replace('/login');
      })
      .catch(() => {
        setLiveToast('로그인 상태를 확인할 수 없습니다. 다시 로그인한 뒤 API 키를 설정해 주세요.');
      });
  }, [router, userId]);

  // ── 자막 추가 (Gemini Live Translate / Browser Tab Rx 공용) ──────────────
  const appendSubtitle = useCallback((text: string) => {
    const clean = extractTranslation(text, micLangRef.current);
    setLiveSubtitles((prev) => [
      ...prev.slice(-49),
      { id: `${Date.now()}-${Math.random()}`, text: clean, timestamp: Date.now() },
    ]);
  }, []);
  const clearSubtitles = useCallback(() => setLiveSubtitles([]), []);

  // Browser Tab Live Translate Rx — 탭 오디오 캡처 + 전용 Gemini Live 세션
  const browserTabRx = useBrowserTabRx({
    startVADWeb,
    vadSpeed,
    onSubtitle: appendSubtitle,
    onSessionStart: clearSubtitles,
    onMissingApiKey: openApiKeyModal,
  });
  const browserTabAudio = browserTabRx.audio;

  const listenLanguageLabel = SUPPORTED_LANGUAGES.find((l) => l.code === micLang)?.label ?? micLang;
  const meetingVoiceLanguageLabel = SUPPORTED_LANGUAGES.find((l) => l.code === sysLang)?.label ?? sysLang;

  // ── Electron 환경 감지 (마운트 시 1회) ──────
  useEffect(() => {
    const detected = !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
    setIsElectron(detected);
  }, []);

  useEffect(() => {
    micLangRef.current = micLang;
  }, [micLang]);

  // ── Gemini Live Translate 자막 콜백 등록 (마운트 시 1회) ──────────────
  useEffect(() => {
    setLiveSubtitleCallback(appendSubtitle);
  }, [setLiveSubtitleCallback, appendSubtitle]);

  // ── V2 자막 자동 스크롤 ──────────────────────────────────
  useEffect(() => {
    if (liveSubtitles.length > 0) {
      subtitleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveSubtitles]);

  // ── 인증 체크 + API 키 로드 ─────────────────
  useEffect(() => {
    async function init() {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setUserId(user.id);

      // ElevenLabs API 키 — 유저별 격리 스토리지에서 자동 로드
      const { elevenLabsApiKey: savedElKey } = loadUserSettings(user.id);
      if (savedElKey) setElevenLabsApiKey(savedElKey);

      // 1순위: 세션 캐시 (동일 세션 내 빠른 접근 — 로그아웃 시 clearCachedApiKey로 제거됨)
      const cached = getCachedApiKey();
      if (cached) { setApiKey(cached); return; }

      // 2순위: localStorage 영구 저장 (앱 재시작 후에도 자동 복원)
      const local = loadKeyLocally();
      if (local && local.userId === user.id) {
        try {
          const decrypted = await decryptApiKey(local.encrypted, local.userId);
          setApiKey(decrypted);
          cacheApiKeyInSession(decrypted);
          return;
        } catch { /* 손상된 경우 무시하고 Supabase 시도 */ }
      }

      // 3순위: Supabase에서 복호화
      const encrypted = await loadEncryptedKey(user.id);
      if (encrypted) {
        try {
          const decrypted = await decryptApiKey(encrypted, user.id);
          setApiKey(decrypted);
          cacheApiKeyInSession(decrypted);
          saveKeyLocally(encrypted, user.id); // 다음 재시작을 위해 로컬 저장
        } catch {
          setShowApiModal(true);
        }
      } else {
        setShowApiModal(true); // 최초 로그인 → API 키 입력 요청
      }
    }
    init();
  }, [router, setElevenLabsApiKey]);

  // ── 자동 오디오 설정 결과 → device state 반영 ──────────
  useEffect(() => {
    if (autoAudio.state !== 'ready') return;
    setMicDeviceId(autoAudio.micId);
    setVirtualMicDeviceId(autoAudio.virtualMicId);
    setEarphoneDeviceId(autoAudio.earphoneId);
    setVirtualMicDevice(autoAudio.virtualMicId);
    setEarphoneDevice(autoAudio.earphoneId);
    setVirtualCableReady(true);
  }, [autoAudio.state, autoAudio.micId, autoAudio.virtualMicId, autoAudio.earphoneId, setVirtualMicDevice, setEarphoneDevice, setVirtualCableReady]);

  useEffect(() => {
    setCableDetected(autoAudio.hasVirtualRoute);
    if (autoAudio.hasVirtualRoute) setVirtualCableReady(true);
  }, [autoAudio.hasVirtualRoute, setVirtualCableReady]);

  // ── 로그아웃 ────────────────────────────────
  async function handleLogout() {
    // 메모리·세션에 올라간 API 키 즉시 초기화 — 다음 사용자가 볼 수 없도록
    // sessionStorage 평문 캐시는 init()이 사용자 확인 없이 신뢰하므로 반드시 제거
    // (localStorage 암호화 사본은 userId 검증 후에만 복호화되므로 유지)
    clearCachedApiKey();
    setApiKey('');
    customTTS.resetElevenLabs();
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // ── Gemini Live Translate: TTS 출력 모드 전환 ─────────────────────────
  function handleCustomTTSToggle(enabled: boolean) {
    customTTS.setLiveCustomTTS(enabled);
    if (enabled) {
      geminiLive.enableCustomTTS(liveCustomTTSCallbackRef.current);
    } else {
      geminiLive.disableCustomTTS();
    }
  }

  // ── Gemini Live Translate: speaking 상태 폴링 (RAF) ───────────────
  // muteUntilRef는 렌더를 트리거하지 않으므로 RAF로 직접 polling — 값이 바뀔 때만 setState
  useEffect(() => {
    if (!liveActive) { setIsSpeakingLive(false); return; }
    const muteUntilRef = geminiLive.muteUntilRef;
    let rafId: number;
    let last: boolean | null = null;
    const poll = () => {
      const speaking = Date.now() < muteUntilRef.current;
      if (speaking !== last) {
        last = speaking;
        setIsSpeakingLive(speaking);
      }
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [liveActive, geminiLive.muteUntilRef]);

  // ── Gemini Live Translate: WS 상태 변화 감지 ──────────────────────
  // 'ready' → VAD 시작 / 'error' → 토스트 + 정리 / 예상치 못한 'disconnected' → 정리
  useEffect(() => {
    if (!liveStartedRef.current) return;

    if (geminiLive.state === 'ready' && !stopLiveVADRef.current) {
      // WS 연결 완료 → Silero VAD 시작
      liveWasReadyRef.current = true; // 최초 ready 도달 표시
      // 임시 noop을 즉시 등록해 async 완료 전 중복 실행 방지 (race condition)
      stopLiveVADRef.current = () => {};
      startVADWeb(
        'mic',
        {
          onSpeechStart: () => setIsVADProcessing(true),
          onSpeechEnd: (chunk) => {
            geminiLive.sendAudioChunk(chunk.base64);
            setIsVADProcessing(false);
          },
          onVADFallback: (reason) =>
            setLiveToast(`VAD 초기화 실패 (${reason}) — RMS 폴백으로 동작 중`),
        },
        { muteUntilRef: geminiLive.muteUntilRef, ...VAD_SPEED_PRESETS[vadSpeed] }
      )
        .then((cleanup) => { stopLiveVADRef.current = cleanup; })
        .catch((err: Error) => {
          stopLiveVADRef.current = null;
          setLiveToast(`VAD 시작 실패: ${err.message}`);
          handleLiveStop();
        });

      // 두 번째 VAD — 시스템 오디오(상대방 음성) 대상
      // muteUntilRef로 Gemini 출력 중 에코 섹션 자동 차단
      if (!stopLiveSysVADRef.current && pipeline.isSysActive) {
        stopLiveSysVADRef.current = () => {}; // race condition 방지
        startVADWeb(
          'sys',
          {
            onSpeechStart: () => {},
            onSpeechEnd: (chunk) => {
              geminiLive.sendAudioChunk(chunk.base64);
            },
            onVADFallback: (reason) =>
              console.warn(`[LiveSysVAD] 폴백: ${reason}`),
          },
          { muteUntilRef: geminiLive.muteUntilRef, ...VAD_SPEED_PRESETS[vadSpeed] }
        )
          .then((cleanup) => { stopLiveSysVADRef.current = cleanup; })
          .catch((err: Error) => {
            stopLiveSysVADRef.current = null;
            console.warn('[LiveStart] 시스템 VAD 시작 실패:', err.message);
          });
      }
    }

    if (geminiLive.state === 'error') {
      setLiveToast(geminiLive.error ?? GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE);
      // 오디오 격리: UI가 '대기'로 돌아가면 VAD(mic/sys)·WS·재연결이 전부 멈춰야 한다.
      // (이전에는 liveActive만 꺼서 훅이 재연결하면 VAD가 계속 송출 → 이어폰/TalkSync Tx로 번역 음성 유출)
      // handleLiveStop의 disconnect()가 state를 'disconnected'로 바꿔도 liveStartedRef=false라 이 effect는 무시.
      handleLiveStop();
    }

    if (geminiLive.state === 'disconnected' && liveWasReadyRef.current) {
      // ready 이후 예상치 못한 연결 끊김만 처리
      // (connect() 전 setLiveActive(true) 리렌더링 시 state='disconnected' 오발 방지)
      setLiveToast('Gemini Live Translate 연결이 끊겼습니다. 다시 시작해 주세요.');
      liveWasReadyRef.current = false;
      liveStartedRef.current = false;
      setLiveActive(false);
      stopLiveVADRef.current?.();
      stopLiveVADRef.current = null;
      stopLiveSysVADRef.current?.();
      stopLiveSysVADRef.current = null;
    }
    // pipeline.startVADWeb / geminiLive.sendAudioChunk 는 안정적인 useCallback refs
    // state 전이 시점에만 실행 — vadSpeed / handleLiveStop / pipeline.isSysActive(getter)는 그 시점 값을 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiLive.state]);

  // ── Gemini Live Translate: 토스트 자동 소거 ────────────────────────
  useEffect(() => {
    if (!liveToast) return;
    const t = setTimeout(() => setLiveToast(null), 6000);
    return () => clearTimeout(t);
  }, [liveToast]);

  // ── P0 isolation hard-gate (device routing must protect AI-only claim)
  const buildIsolationGateInput = useCallback(
    () => ({
      scanState: autoAudio.state,
      bindingMode: autoAudio.bindingMode,
      inputs: pipeline.devices.inputs,
      outputs: pipeline.devices.outputs,
      micDeviceId,
      virtualMicDeviceId,
      earphoneDeviceId,
    }),
    [
      autoAudio.state,
      autoAudio.bindingMode,
      pipeline.devices.inputs,
      pipeline.devices.outputs,
      micDeviceId,
      virtualMicDeviceId,
      earphoneDeviceId,
    ]
  );
  const isolationGate = useMemo(
    () => evaluateIsolationHardGate(buildIsolationGateInput()),
    [buildIsolationGateInput]
  );

  // ── Gemini Live Translate: 시작 ────────────────────────────────────
  async function handleLiveStart() {
    if (!apiKey) {
      openApiKeyModal();
      return;
    }

    if (browserTabRx.isRunning()) {
      setLiveToast('Browser Tab Live Translate가 실행 중입니다. 먼저 중지해 주세요.');
      return;
    }

    // Re-evaluate at click time so advanced-device overrides cannot bypass the button state
    const gate = evaluateIsolationHardGate(buildIsolationGateInput());
    if (!gate.ok) {
      setLiveToast(isolationGateDisabledReason(gate));
      return;
    }

    // 선택된 마이크 장치를 직접 캡처 (desktopCapturer silent stream 우회)
    if (!pipeline.isMicActive) {
      try {
        await pipeline.setMicDevice(micDeviceId);
        await pipeline.captureMic();
      } catch (err) {
        const base = err instanceof Error ? err.message : '마이크 캡처 실패';
        setLiveToast(`${base} — 마이크 장치를 확인해 주세요`);
        return;
      }
    }

    // 시스템 오디오 캐처 (상대방 음성 번역용) — 실패해도 마이크 번역은 동작
    if (!pipeline.isSysActive) {
      try {
        await pipeline.captureSystemAudio();
      } catch (e) {
        console.warn('[LiveStart] 시스템 오디오 캐처 실패 (상대방 번역 비활성화):', e);
      }
    }

    liveStartedRef.current = true;
    setLiveActive(true);
    setIsVADProcessing(false);

    // 현재 TTS 모드를 훅에 즉시 반영 (connect 전에 설정)
    if (liveCustomTTS) {
      geminiLive.enableCustomTTS(liveCustomTTSCallbackRef.current);
    } else {
      geminiLive.disableCustomTTS();
    }

    // WS 연결 시작 (비동기) — 'ready' 이벤트가 오면 위 useEffect에서 VAD 자동 시작
    const sourceLangLabel = SUPPORTED_LANGUAGES.find((l) => l.code === sysLang)?.label ?? sysLang;
    const targetLangLabel = SUPPORTED_LANGUAGES.find((l) => l.code === micLang)?.label ?? micLang;
    const systemInstruction = buildBidirectionalInstruction(sourceLangLabel, targetLangLabel);

    geminiLive.connect({
      apiKey,
      voiceName: liveVoice,
      outputDeviceId: earphoneDeviceId,
      virtualMicDeviceId,
      systemInstruction,
    }).catch((err: Error) => {
      setLiveToast(`연결 실패: ${err.message}`);
      liveStartedRef.current = false;
      setLiveActive(false);
    });
  }

  // ── Gemini Live Translate: 정지 ────────────────────────────────────
  function handleLiveStop() {
    liveStartedRef.current = false;
    liveWasReadyRef.current = false;
    stopLiveVADRef.current?.();
    stopLiveVADRef.current = null;
    stopLiveSysVADRef.current?.();
    stopLiveSysVADRef.current = null;
    geminiLive.disconnect();
    geminiLive.disableCustomTTS(); // 커스텀 TTS 모드 초기화
    setLiveActive(false);
    setIsVADProcessing(false);
    setIsSpeakingLive(false);
    setLiveSubtitles([]);
  }

  // Isolation hard-gate is source of truth; virtualCableReady remains for banner timing only
  const fullVoiceReplacementReady = isolationGate.ok && virtualCableReady !== false;
  const driverCheckInProgress = virtualCableReady === null || autoAudio.state === 'scanning';
  const driverNoticeVisible = !fullVoiceReplacementReady;
  const isolationDisabledReason =
    isolationGateDisabledReason(isolationGate) || '양방향 치환 모드는 드라이버 필요';
  const livePhase: LivePhase =
    isSpeakingLive   ? 'speaking'
    : isVADProcessing  ? 'processing'
    :                   'listening';

  // 웹 환경(비 Electron) — 프로덕션은 다운로드 안내 유지, dev localhost는 Browser Tab capture smoke 허용
  if (isElectron === false && !ENABLE_BROWSER_TAB_CAPTURE_WEB_DEV) return <WebOnlyFallback />;

  return (
    <>
      {/* ElevenLabs 보이스 패치 에러 토스트 */}
      {customTTS.elVoicesError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[150] bg-red-700 text-white px-4 py-3 rounded-2xl shadow-2xl text-sm flex items-center gap-2 max-w-sm">
          <span className="text-base">🔑</span>
          <span>{customTTS.elVoicesError} — 저장된 음성을 그대로 사용합니다</span>
        </div>
      )}

      {/* Gemini Live Translate 에러 / 경고 토스트 */}
      {liveToast && (
        <div className="fixed top-4 right-4 z-[150] bg-zinc-900 text-white px-4 py-3 rounded-2xl shadow-2xl text-sm flex items-center gap-2.5 max-w-xs animate-in slide-in-from-right-4">
          <span className="shrink-0 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-[10px] font-bold">!</span>
          <span className="leading-relaxed">{liveToast}</span>
        </div>
      )}

      {/* API 키 모달 */}
      {showApiModal && (
        <ApiKeyModal
          userId={userId || null}
          hasExistingKey={Boolean(apiKey)}
          onUserResolved={setUserId}
          onSave={(key) => { setApiKey(key); setShowApiModal(false); }}
          onClose={() => setShowApiModal(false)}
        />
      )}

      <div className="flex flex-col h-screen bg-zinc-50">
        {/* ── 헤더 ── */}
        <StudioHeader
          liveActive={liveActive}
          micLang={micLang}
          sysLang={sysLang}
          apiKey={apiKey}
          onMicLangChange={setMicLang}
          onSysLangChange={setSysLang}
          onOpenApiKey={openApiKeyModal}
          onLogout={handleLogout}
        />

        {/* ── 메인 콘텐츠 ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* 자막 영역 */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {liveActive ? (
                <SubtitleFeed subtitles={liveSubtitles} phase={livePhase} endRef={subtitleEndRef} />
              ) : (
                <UsageGuide
                  apiKeyReady={Boolean(apiKey)}
                  autoAudioState={autoAudio.state}
                  cableDetected={cableDetected}
                  earphoneSelected={earphoneDeviceId !== 'default'}
                  onOpenApiKey={openApiKeyModal}
                />
              )}
            </div>
          </div>

          {/* 우측 광고 사이드바 */}
          <aside className="w-72 border-l border-zinc-100 bg-white p-4 hidden lg:flex flex-col gap-4">
            <div className="flex-1 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl flex items-center justify-center">
              <div className="text-center">
                <p className="text-xs text-zinc-400">Google AdSense</p>
                <p className="text-xs text-zinc-300 mt-0.5">300 × 600</p>
              </div>
            </div>
          </aside>
        </div>

        {/* ── 컨트롤 바 ── */}
        <div className="bg-white border-t border-zinc-100 px-5 py-4 shadow-lg">

          {driverNoticeVisible && (
            <DriverNotice checking={driverCheckInProgress} onRescan={autoAudio.rescan} />
          )}

          {/* Browser Tab Translate Mode — capture-only MVP */}
          <BrowserTabTranslatePanel
            state={browserTabAudio.state}
            sourceLabel={browserTabAudio.sourceLabel}
            error={browserTabAudio.error}
            level={browserTabAudio.level}
            hasAudioTrack={browserTabAudio.hasAudioTrack}
            targetLanguageLabel={listenLanguageLabel}
            txLanguageLabel={meetingVoiceLanguageLabel}
            liveState={browserTabRx.panelLiveState}
            liveError={browserTabRx.error}
            apiKeyReady={Boolean(apiKey)}
            onStartCapture={browserTabRx.startCapture}
            onStopCapture={browserTabRx.stopCapture}
            onStartTranslate={() => browserTabRx.start({ apiKey, liveActive, micLang, liveVoice, earphoneDeviceId })}
            onStopTranslate={browserTabRx.stop}
          />

          {/* Gemini Live Translate V2 통역 패널 */}
          <div className="mb-4">
            <GeminiLivePanel
              wsState={geminiLive.state}
              liveActive={liveActive}
              livePhase={livePhase}
              liveVoice={liveVoice}
              liveError={null}
              txWarning={geminiLive.txError}
              liveCustomTTS={liveCustomTTS}
              disabled={!fullVoiceReplacementReady}
              disabledReason={isolationDisabledReason}
              onStart={handleLiveStart}
              onStop={handleLiveStop}
              onVoiceChange={setLiveVoice}
              onCustomTTSChange={handleCustomTTSToggle}
              vadSpeed={vadSpeed}
              onVadSpeedChange={setVadSpeed}
            />
          </div>

          {/* P0 isolation preflight checklist */}
          {!liveActive && <IsolationChecklist gate={isolationGate} />}

          {/* ── 오디오 자동 설정 패널 ── */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <AudioSetupPanel
              autoAudio={autoAudio}
              manualSelectors={
                <ManualDeviceSelectors
                  inputs={pipeline.devices.inputs}
                  outputs={pipeline.devices.outputs}
                  micDeviceId={micDeviceId}
                  virtualMicDeviceId={virtualMicDeviceId}
                  earphoneDeviceId={earphoneDeviceId}
                  onMicChange={(id) => { setMicDeviceId(id); setMicDevice(id); }}
                  onVirtualMicChange={(id) => { setVirtualMicDeviceId(id); setVirtualMicDevice(id); }}
                  onEarphoneChange={(id) => { setEarphoneDeviceId(id); setEarphoneDevice(id); }}
                />
              }
            />

            {/* 오른쪽: 마이크 레벨 (자체 RAF — 페이지 리렌더 없음) */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-zinc-400">레벨</span>
              <MicLevelMeter getLevel={getMicLevel} active={liveActive} color="bg-zinc-900" />
            </div>
          </div>

          {/* 하단 광고 */}
          <div className="mt-3 bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-2xl h-10 flex items-center justify-center">
            <p className="text-xs text-zinc-300">Google AdSense 728 × 90</p>
          </div>
        </div>
      </div>
    </>
  );
}
