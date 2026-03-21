'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslationPipeline, type PipelineConfig } from '@/hooks/useTranslationPipeline';
import { SUPPORTED_LANGUAGES } from '@/lib/stt';
import { validateGeminiKey } from '@/lib/gemini';
import { encryptApiKey, decryptApiKey, cacheApiKeyInSession, getCachedApiKey, saveKeyLocally, loadKeyLocally } from '@/lib/crypto';
import { getSupabaseClient, getCurrentUser, saveEncryptedKey, loadEncryptedKey } from '@/lib/supabase';
import { DeviceSelector } from '@/components/audio/DeviceSelector';
import { TTS_VOICE_PRESETS } from '@/lib/tts';

// ── 음성 레벨 바 ──────────────────────────────
function LevelBar({ level, color = 'bg-zinc-900' }: { level: number; color?: string }) {
  return (
    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden w-20">
      <div
        className={`h-full ${color} transition-all duration-75 rounded-full`}
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}

// ── 자막 카드 ─────────────────────────────────
function TranscriptCard({
  original, translated, source, isStreaming,
}: {
  original: string; translated: string; source: 'mic' | 'sys'; isStreaming?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-4 border transition-all ${
      source === 'mic'
        ? 'bg-zinc-900 border-zinc-800 text-white'
        : 'bg-white border-zinc-100 text-zinc-900'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs opacity-50">{source === 'mic' ? '🎙 내 음성' : '🎧 상대방'}</span>
        {isStreaming && (
          <span className="flex gap-0.5 items-end h-3">
            {[0, 1, 2].map((i) => (
              <span key={i}
                className={`w-0.5 rounded-full animate-bounce ${source === 'mic' ? 'bg-white/50' : 'bg-zinc-400'}`}
                style={{ height: `${6 + i * 2}px`, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
        )}
      </div>
      <p className="text-xs opacity-50 mb-1.5 leading-relaxed">{original}</p>
      <p className="text-sm font-medium leading-relaxed">
        {translated || (isStreaming ? <span className="opacity-40 italic">번역 중...</span> : '')}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────
// 가상 오디오 장치 감지
//
// VB-Cable (Windows) / BlackHole (macOS) / Voicemeeter / Soundflower 등
// 장치 라벨에서 가상 오디오 드라이버 키워드를 검색
// ─────────────────────────────────────────────
const VIRTUAL_AUDIO_KEYWORDS = ['cable', 'virtual', 'blackhole', 'voicemeeter', 'soundflower', 'vb-audio'];

async function detectVirtualAudioDevice(): Promise<boolean> {
  try {
    // 권한 없이 호출하면 라벨이 빈 문자열로 오므로 먼저 마이크 권한 요청
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* 이미 허용됐거나 불가 — 계속 진행 */ }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => {
      const label = d.label.toLowerCase();
      return VIRTUAL_AUDIO_KEYWORDS.some((kw) => label.includes(kw));
    });
  } catch {
    return false;
  }
}

// ── 가상 오디오 케이블 필수 설치 가드 ─────────
// 장치가 감지될 때까지 닫을 수 없는 전체화면 블로킹 모달
// Electron shell.openExternal 래퍼 — 웹 환경에서는 window.open 폴백
function openExternal(url: string) {
  const api = (window as Window & { electronAPI?: { openExternal: (u: string) => void } }).electronAPI;
  if (api?.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function VirtualCableGuard({ onDetected }: { onDetected: () => void }) {
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  // ESC 키 및 배경 클릭으로 닫히지 않도록 키보드 이벤트 흡수
  useEffect(() => {
    const block = (e: KeyboardEvent) => { if (e.key === 'Escape') e.stopImmediatePropagation(); };
    window.addEventListener('keydown', block, { capture: true });
    return () => window.removeEventListener('keydown', block, { capture: true });
  }, []);

  async function handleRecheck() {
    setChecking(true);
    setFailed(false);
    await new Promise((r) => setTimeout(r, 800)); // 드라이버 인식 대기
    const found = await detectVirtualAudioDevice();
    setChecking(false);
    if (found) {
      onDetected();
    } else {
      setFailed(true);
    }
  }

  return (
    // 배경 클릭 이벤트 소비 — 클릭해도 닫히지 않음
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 border border-zinc-100">
        {/* 헤더 */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">🔌</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">가상 오디오 드라이버 필요</h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              TalkSync는 번역된 음성을 Discord/Teams로 전달하기 위해<br />
              가상 오디오 케이블이 반드시 필요합니다.
            </p>
          </div>
        </div>

        {/* 동작 원리 */}
        <div className="bg-zinc-50 rounded-2xl p-4 mb-6 border border-zinc-100">
          <p className="text-xs font-semibold text-zinc-500 mb-3 uppercase tracking-wide">동작 원리</p>
          <div className="flex items-center gap-2 text-xs text-zinc-600">
            <span className="px-2 py-1 bg-white rounded-lg border border-zinc-200 font-medium">내 목소리</span>
            <span className="text-zinc-300">→</span>
            <span className="px-2 py-1 bg-white rounded-lg border border-zinc-200 font-medium">TalkSync 번역</span>
            <span className="text-zinc-300">→</span>
            <span className="px-2 py-1 bg-amber-50 rounded-lg border border-amber-200 font-medium text-amber-700">가상 케이블</span>
            <span className="text-zinc-300">→</span>
            <span className="px-2 py-1 bg-white rounded-lg border border-zinc-200 font-medium">Discord</span>
          </div>
        </div>

        {/* 설치 안내 */}
        <div className="space-y-3 mb-6">
          {/* Windows */}
          <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <span className="text-xl mt-0.5">🪟</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-900">Windows — VB-CABLE (무료)</p>
              <p className="text-xs text-blue-600 mt-1 leading-relaxed">
                VBCABLE_Driver_Pack 다운로드 → VBCABLE_Setup_x64.exe 관리자 실행 → 재부팅
              </p>
              <button
                onClick={() => openExternal('https://vb-audio.com/Cable/')}
                className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded-xl transition-colors"
              >
                다운로드 →
              </button>
            </div>
          </div>

          {/* macOS */}
          <div className="flex items-start gap-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
            <span className="text-xl mt-0.5">🍎</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800">macOS — BlackHole (무료)</p>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                BlackHole 2ch 설치 → 오디오 MIDI 설정에서 장치 확인
              </p>
              <button
                onClick={() => openExternal('https://existential.audio/blackhole/')}
                className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-zinc-700 bg-zinc-200 hover:bg-zinc-300 px-3 py-1.5 rounded-xl transition-colors"
              >
                다운로드 →
              </button>
            </div>
          </div>
        </div>

        {/* 재확인 실패 메시지 */}
        {failed && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
            가상 오디오 장치를 찾을 수 없습니다. 설치 후 <strong>재부팅</strong>이 필요할 수 있습니다.
          </div>
        )}

        {/* 재확인 버튼 */}
        <button
          onClick={handleRecheck}
          disabled={checking}
          className="w-full py-3 bg-zinc-900 hover:bg-zinc-700 disabled:bg-zinc-300 text-white font-medium rounded-2xl transition-colors text-sm shadow-lg shadow-zinc-900/20 flex items-center justify-center gap-2"
        >
          {checking ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              장치 확인 중...
            </>
          ) : (
            '설치 완료 — 다시 확인하기'
          )}
        </button>

        <p className="text-center text-xs text-zinc-300 mt-3">
          장치가 감지될 때까지 이 창은 닫히지 않습니다
        </p>
      </div>
    </div>
  );
}

// ── 웹 환경 진입 차단 Fallback ────────────────
// Vercel/브라우저에서 /studio 직접 접근 시 전체 화면 안내 표시
// 데스크탑 앱(Electron)에서는 렌더링되지 않음
const WEB_DOWNLOAD_URL =
  "https://github.com/cakemans81-source/talksync/releases/latest/download/TalkSync-Setup.exe";

function WebOnlyFallback() {
  return (
    <div className="fixed inset-0 z-[200] bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {/* 아이콘 */}
        <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-8">
          <span className="text-4xl">🎙</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3 tracking-tight">TalkSync</h1>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          실시간 통역 기능은 <span className="text-white font-medium">Windows 데스크탑 앱</span>에서만 지원됩니다.<br />
          브라우저 환경에서는 시스템 오디오 캡처 및<br />Discord 연동이 불가능합니다.
        </p>

        {/* 다운로드 버튼 */}
        <a
          href={WEB_DOWNLOAD_URL}
          className="inline-flex items-center gap-2.5 bg-white text-zinc-900 px-8 py-3.5 rounded-2xl font-semibold text-sm hover:bg-zinc-100 transition-colors mb-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          Windows용 무료 다운로드
        </a>

        <p className="text-zinc-600 text-xs">
          설치 후 앱을 실행하고 Google 계정으로 로그인하세요
        </p>
      </div>
    </div>
  );
}

// ── API 키 설정 모달 ──────────────────────────
function ApiKeyModal({
  userId, onSave,
}: {
  userId: string;
  onSave: (key: string) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState('');

  async function handleValidate() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError('');
    try {
      const valid = await validateGeminiKey(apiKey.trim());
      if (!valid) throw new Error('유효하지 않은 키입니다. Google AI Studio에서 다시 확인해주세요.');
      setValidated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '검증 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setLoading(true);
    try {
      const encrypted = await encryptApiKey(apiKey.trim(), userId);

      // 로컬 저장 먼저 — Supabase가 실패해도 다음 로그인 시 복원 가능
      saveKeyLocally(encrypted, userId);
      cacheApiKeyInSession(apiKey.trim());

      // Supabase 저장 (실패해도 로컬에 있으므로 앱 동작엔 영향 없음)
      try {
        await saveEncryptedKey(userId, encrypted);
      } catch { /* Supabase 저장 실패 — 로컬에 저장됐으므로 계속 진행 */ }

      onSave(apiKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 border border-zinc-100">
        {/* 헤더 */}
        <div className="flex items-start gap-4 mb-7">
          <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xl">🔑</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Gemini API 키 설정</h2>
            <p className="text-sm text-zinc-400 mt-0.5">통역에 사용할 API 키를 입력해주세요</p>
          </div>
        </div>

        {/* API 가이드 */}
        <div className="bg-zinc-50 rounded-2xl p-4 mb-6 border border-zinc-100">
          <p className="text-xs font-medium text-zinc-700 mb-3">[1분 완성] 무료 API 키 발급</p>
          <div className="space-y-2">
            {[
              { n: '1', text: 'aistudio.google.com 접속 →', link: 'https://aistudio.google.com/app/apikey' },
              { n: '2', text: '"Create API key" 클릭' },
              { n: '3', text: '"AIza..."로 시작하는 키 복사 후 아래 입력' },
            ].map(({ n, text, link }) => (
              <div key={n} className="flex items-center gap-2.5">
                <span className="w-5 h-5 bg-zinc-900 text-white text-xs rounded-full flex items-center justify-center flex-shrink-0 font-bold">{n}</span>
                {link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline">{text}</a>
                ) : (
                  <span className="text-xs text-zinc-600">{text}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* 입력 */}
        <div className="relative mb-4">
          <input
            type="text"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setValidated(false); setError(''); }}
            placeholder="AIzaSy..."
            className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-mono text-zinc-900 placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 focus:border-zinc-400 transition pr-20"
          />
          {validated && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-green-50 text-green-600 font-medium px-2 py-1 rounded-lg border border-green-100">
              ✓ 유효
            </span>
          )}
        </div>

        {/* 버튼 */}
        {!validated ? (
          <button
            onClick={handleValidate}
            disabled={loading || !apiKey.trim()}
            className="w-full py-3 border-2 border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white disabled:border-zinc-200 disabled:text-zinc-300 font-medium rounded-2xl transition-colors text-sm"
          >
            {loading ? '확인 중...' : '키 유효성 확인'}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-700 disabled:bg-zinc-300 text-white font-medium rounded-2xl transition-colors text-sm shadow-lg shadow-zinc-900/20"
          >
            {loading ? '저장 중...' : '저장하고 통역 시작하기 →'}
          </button>
        )}

        <p className="text-center text-xs text-zinc-300 mt-4">
          🔒 키는 AES-256으로 암호화 저장됩니다
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 메인 Studio 페이지
// ─────────────────────────────────────────────
export default function StudioPage() {
  const router = useRouter();
  const pipeline = useTranslationPipeline();
  const subtitleEndRef = useRef<HTMLDivElement>(null);

  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiModal, setShowApiModal] = useState(false);
  const [virtualCableReady, setVirtualCableReady] = useState<boolean | null>(null); // null = 검사 전
  // Electron 여부 — 마운트 후 감지 (SSR hydration mismatch 방지)
  const [isElectron, setIsElectron] = useState<boolean | null>(null);

  const [micLang, setMicLang] = useState('ko-KR');
  const [sysLang, setSysLang] = useState('en-US');
  const [micDeviceId, setMicDeviceId] = useState('default');
  const [virtualMicDeviceId, setVirtualMicDeviceId] = useState('default');
  const [earphoneDeviceId, setEarphoneDeviceId] = useState('default');
  const [ttsVoice, setTtsVoice] = useState('Aoede'); // localStorage에서 복원
  const [ttsRate, setTtsRate] = useState(1.0);       // 말하기 속도 — localStorage에서 복원

  const [micLevel, setMicLevel] = useState(0);
  const [sysLevel, setSysLevel] = useState(0);
  const levelRafRef = useRef<number>(0);
  const [cableDetected, setCableDetected] = useState(false);

  // ── Electron 환경 감지 (마운트 시 1회) ──────
  useEffect(() => {
    const detected = !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
    setIsElectron(detected);
  }, []);

  // ── TTS 음성·속도 설정 복원 ───────────────────
  useEffect(() => {
    const savedVoice = localStorage.getItem('ttsVoice');
    if (savedVoice && TTS_VOICE_PRESETS.some((p) => p.id === savedVoice)) setTtsVoice(savedVoice);

    const savedRate = parseFloat(localStorage.getItem('ttsRate') ?? '');
    if (!isNaN(savedRate) && savedRate >= 0.5 && savedRate <= 2.0) setTtsRate(savedRate);
  }, []);

  // ── 인증 체크 + API 키 로드 ─────────────────
  useEffect(() => {
    async function init() {
      const user = await getCurrentUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setUserId(user.id);

      // 1순위: 세션 캐시 (동일 세션 내 빠른 접근)
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
  }, [router]);

  // ── 가상 오디오 케이블 필수 설치 검사 (Electron 전용) ──────
  // 웹 환경에서는 getDisplayMedia 폴백으로 시스템 오디오를 캡처하므로 검사 불필요
  // Electron 여부는 window.electronAPI.isElectron으로 판별
  useEffect(() => {
    if (virtualCableReady !== null) return;
    const isElectron = !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
    if (!isElectron) {
      setVirtualCableReady(true); // 웹 환경 → 검사 스킵, 즉시 통과
      return;
    }
    detectVirtualAudioDevice().then((found) => setVirtualCableReady(found));
  }, [virtualCableReady]);

  // ── CABLE 자동 감지 + 선택 ─────────────────
  useEffect(() => {
    const outputs = pipeline.devices.outputs;
    if (outputs.length === 0) return;
    const cable = outputs.find((d) => d.label.toLowerCase().includes('cable input'));
    if (cable && virtualMicDeviceId === 'default') {
      setVirtualMicDeviceId(cable.deviceId);
      pipeline.setVirtualMicDevice(cable.deviceId);
      setCableDetected(true);
    }
  }, [pipeline.devices.outputs]);

  // ── 음성 레벨 업데이트 ──────────────────────
  const updateLevels = useCallback(() => {
    if (pipeline.state === 'running') {
      setMicLevel(pipeline.getMicLevel());
      setSysLevel(pipeline.getSysLevel());
    }
    levelRafRef.current = requestAnimationFrame(updateLevels);
  }, [pipeline]);

  useEffect(() => {
    levelRafRef.current = requestAnimationFrame(updateLevels);
    return () => cancelAnimationFrame(levelRafRef.current);
  }, [updateLevels]);

  // ── 자막 자동 스크롤 ────────────────────────
  useEffect(() => {
    subtitleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [pipeline.transcripts, pipeline.interimMic, pipeline.interimSys]);

  // ── 로그아웃 ────────────────────────────────
  async function handleLogout() {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // ── 통역 시작 ────────────────────────────────
  async function handleStart() {
    if (!apiKey) { setShowApiModal(true); return; }
    const config: PipelineConfig = {
      micLang, sysLang, apiKey,
      micDeviceId, virtualMicDeviceId, earphoneDeviceId,
      ttsVoice, ttsRate,
    };
    await pipeline.start(config);
  }

  const isRunning = pipeline.state === 'running';
  const isStarting = pipeline.state === 'starting';

  // 웹 환경(비 Electron) — 전체 화면 다운로드 안내로 대체
  if (isElectron === false) return <WebOnlyFallback />;

  return (
    <>
      {/* 초기 장치 스캔 중 — 메인 UI 노출 전 블로킹 */}
      {virtualCableReady === null && (
        <div className="fixed inset-0 z-[100] bg-white flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <span className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
            <p className="text-sm text-zinc-400">오디오 장치 확인 중...</p>
          </div>
        </div>
      )}

      {/* 가상 오디오 케이블 설치 가드 — 미설치 시 전체 UI 차단 */}
      {virtualCableReady === false && (
        <VirtualCableGuard onDetected={() => setVirtualCableReady(true)} />
      )}

      {/* API 키 모달 */}
      {showApiModal && userId && (
        <ApiKeyModal
          userId={userId}
          onSave={(key) => { setApiKey(key); setShowApiModal(false); }}
        />
      )}

      <div className="flex flex-col h-screen bg-zinc-50">
        {/* ── 헤더 ── */}
        <header className="flex items-center justify-between px-5 py-3 bg-white border-b border-zinc-100 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-zinc-900 tracking-tight">TalkSync</span>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              isRunning ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-zinc-300'}`} />
              {isRunning ? '통역 중' : '대기'}
            </div>
          </div>

          {/* 언어 선택 */}
          <div className="flex items-center gap-2">
            <select
              value={micLang}
              onChange={(e) => setMicLang(e.target.value)}
              disabled={isRunning}
              className="text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 transition disabled:opacity-50"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
              ))}
            </select>
            <span className="text-zinc-400 text-base">⇄</span>
            <select
              value={sysLang}
              onChange={(e) => setSysLang(e.target.value)}
              disabled={isRunning}
              className="text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 transition disabled:opacity-50"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={pipeline.clearTranscripts}
              className="text-xs text-zinc-400 hover:text-zinc-600 px-3 py-2 rounded-xl hover:bg-zinc-100 transition"
            >
              자막 지우기
            </button>
            <button
              onClick={() => setShowApiModal(true)}
              className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl transition ${
                apiKey
                  ? 'text-green-700 bg-green-50 hover:bg-green-100 border border-green-200'
                  : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${apiKey ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`} />
              {apiKey
                ? `🔑 AIza···${apiKey.slice(-4)}`
                : '🔑 API 키 미설정'}
            </button>
            <button
              onClick={handleLogout}
              className="text-xs text-zinc-400 hover:text-zinc-600 px-3 py-2 rounded-xl hover:bg-zinc-100 transition"
            >
              로그아웃
            </button>
          </div>
        </header>

        {/* ── 메인 콘텐츠 ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* 자막 영역 */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {/* 빈 상태 */}
              {pipeline.transcripts.length === 0 && !pipeline.interimMic && !pipeline.interimSys && (
                <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
                  <div className="w-16 h-16 bg-white border border-zinc-100 rounded-3xl flex items-center justify-center shadow-sm">
                    <span className="text-3xl">🎙</span>
                  </div>

                  {!apiKey && (
                    <button
                      onClick={() => setShowApiModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl hover:bg-amber-100 transition"
                    >
                      ⚠ Gemini API 키 설정 필요
                    </button>
                  )}

                  {/* 사용 가이드 */}
                  <div className="w-full max-w-xl space-y-2">
                    {[
                      {
                        icon: '🔌',
                        title: 'VB-CABLE 자동 감지',
                        desc: cableDetected ? 'CABLE Input이 자동으로 선택됐어요' : 'VB-CABLE이 감지되지 않았어요 — 아래 링크에서 설치 후 새로고침하세요',
                        done: cableDetected,
                        action: !cableDetected ? { label: 'VB-CABLE 설치', href: 'https://vb-audio.com/Cable/' } : undefined,
                      },
                      {
                        icon: '🎧',
                        title: '이어폰 선택',
                        desc: earphoneDeviceId !== 'default' ? '이어폰이 선택됐어요' : '아래 "이어폰 출력" 드롭다운에서 본인 헤드셋을 선택하세요',
                        done: earphoneDeviceId !== 'default',
                      },
                      {
                        icon: '💬',
                        title: 'Discord 마이크를 CABLE Output으로 변경',
                        desc: 'Discord → ⚙️ 설정 → 음성 및 비디오 → 입력 장치 → "CABLE Output" 선택',
                        done: false,
                      },
                      {
                        icon: '▶️',
                        title: '통역 시작 클릭',
                        desc: '탭 공유 창이 뜨면 Discord 탭 선택 → "탭 오디오도 공유" ON → 공유 클릭',
                        done: false,
                      },
                    ].map(({ icon, title, desc, done, action }) => (
                      <div key={title} className={`flex items-start gap-3 p-4 rounded-2xl border transition-all ${
                        done ? 'bg-green-50 border-green-100' : 'bg-white border-zinc-100'
                      }`}>
                        <span className="text-xl mt-0.5">{done ? '✅' : icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${done ? 'text-green-700' : 'text-zinc-800'}`}>{title}</p>
                          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{desc}</p>
                          {action && (
                            <a href={action.href} target="_blank" rel="noopener noreferrer"
                              className="inline-block mt-2 text-xs font-medium text-blue-600 hover:underline">
                              {action.label} →
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 자막 목록 */}
              {pipeline.transcripts.map((t) => (
                <TranscriptCard
                  key={t.id}
                  source={t.source}
                  original={t.original}
                  translated={t.translated}
                  isStreaming={t.isStreaming}
                />
              ))}

              {/* 실시간 interim 자막 */}
              {pipeline.interimMic && (
                <div className="rounded-2xl p-4 bg-zinc-800/70 border border-zinc-700 text-white">
                  <p className="text-xs mb-1 opacity-40">🎙 인식 중...</p>
                  <p className="text-sm opacity-60 italic">{pipeline.interimMic}</p>
                </div>
              )}
              {pipeline.interimSys && (
                <div className="rounded-2xl p-4 bg-white/70 border border-zinc-200 text-zinc-500">
                  <p className="text-xs mb-1 opacity-50">🎧 인식 중...</p>
                  <p className="text-sm italic">{pipeline.interimSys}</p>
                </div>
              )}
              <div ref={subtitleEndRef} />
            </div>

            {/* 에러 */}
            {pipeline.error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600">
                ⚠ {pipeline.error}
              </div>
            )}
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
          <div className="flex items-end justify-between gap-4 flex-wrap">
            {/* 장치 선택 */}
            <div className="flex gap-4 flex-wrap">
              <DeviceSelector
                label="내 마이크 입력"
                devices={pipeline.devices.inputs}
                value={micDeviceId}
                onChange={(id) => { setMicDeviceId(id); pipeline.setMicDevice(id); }}
                hint="CABLE Output 제외한 실제 마이크 선택"
              />
              <DeviceSelector
                label="가상 마이크 출력 (CABLE Input)"
                devices={pipeline.devices.outputs}
                value={virtualMicDeviceId}
                onChange={(id) => { setVirtualMicDeviceId(id); pipeline.setVirtualMicDevice(id); }}
                hint="Discord/Teams 마이크: CABLE Output 선택"
                requiresCable
              />
              <DeviceSelector
                label="이어폰 출력"
                devices={pipeline.devices.outputs}
                value={earphoneDeviceId}
                onChange={(id) => { setEarphoneDeviceId(id); pipeline.setEarphoneDevice(id); }}
              />
              {/* TTS 음성 선택 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-500">TTS 음성</label>
                <select
                  value={ttsVoice}
                  onChange={(e) => {
                    setTtsVoice(e.target.value);
                    localStorage.setItem('ttsVoice', e.target.value);
                  }}
                  className="h-9 px-3 text-sm bg-white border border-zinc-200 rounded-xl text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-300 cursor-pointer"
                >
                  {TTS_VOICE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* TTS 말하기 속도 */}
              <div className="flex flex-col gap-1.5 min-w-[120px]">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-500">말하기 속도</label>
                  <span className="text-xs font-semibold text-zinc-700 tabular-nums">{ttsRate.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={ttsRate}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setTtsRate(val);
                    localStorage.setItem('ttsRate', String(val));
                  }}
                  className="h-1.5 w-full appearance-none rounded-full bg-zinc-200 accent-zinc-900 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-300">
                  <span>0.5x</span>
                  <span>1.0x</span>
                  <span>2.0x</span>
                </div>
              </div>
            </div>

            {/* 오른쪽: 레벨 + 버튼 */}
            <div className="flex items-center gap-5">
              {/* 음성 레벨 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-7">내</span>
                  <LevelBar level={micLevel} color="bg-zinc-900" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 w-7">상대</span>
                  <LevelBar level={sysLevel} color="bg-blue-500" />
                </div>
              </div>

              {/* 시작/정지 */}
              {!isRunning ? (
                <button
                  onClick={handleStart}
                  disabled={isStarting}
                  className="flex items-center gap-2 px-6 py-3 bg-zinc-900 hover:bg-zinc-700 disabled:bg-zinc-300 text-white font-medium rounded-2xl transition-colors text-sm shadow-lg shadow-zinc-900/20 whitespace-nowrap"
                >
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  {isStarting ? '연결 중...' : '통역 시작'}
                </button>
              ) : (
                <button
                  onClick={pipeline.stop}
                  className="flex items-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-2xl transition-colors text-sm shadow-lg shadow-red-500/30 whitespace-nowrap"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  정지
                </button>
              )}
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
