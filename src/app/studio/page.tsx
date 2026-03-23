'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslationPipeline, type PipelineConfig } from '@/hooks/useTranslationPipeline';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { SUPPORTED_LANGUAGES } from '@/lib/stt';
import { validateGeminiKey } from '@/lib/gemini';
import { encryptApiKey, decryptApiKey, cacheApiKeyInSession, getCachedApiKey, saveKeyLocally, loadKeyLocally } from '@/lib/crypto';
import { getSupabaseClient, getCurrentUser, saveEncryptedKey, loadEncryptedKey } from '@/lib/supabase';
import { loadUserSettings, saveUserSettings } from '@/lib/userSettings';
import { DeviceSelector } from '@/components/audio/DeviceSelector';
import { useAutoAudioSetup } from '@/hooks/useAutoAudioSetup';
import {
  TTS_VOICE_PRESETS, ELEVENLABS_VOICE_PRESETS, GEMINI_TTS_VOICE_PRESETS,
  fetchElevenLabsVoices, buildElevenLabsLabel,
  synthesizeEdgeTTS, synthesizeElevenLabsTTS, synthesizeGeminiTTS, defaultEdgeVoiceForLang,
  type TTSEngine, type ElevenLabsVoice,
} from '@/lib/tts';

// ── Gemini 출력 후처리: 타겟 언어 텍스트만 추출 ──────────
function extractTranslation(raw: string, targetLangCode: string): string {
  // 마크다운 제거
  const text = raw.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim();

  // 언어별 문자 패턴
  let charPattern: RegExp | null = null;
  if (targetLangCode.startsWith('ja')) {
    charPattern = /[\u3040-\u30FF]/; // 히라가나/가타카나 필수
  } else if (targetLangCode.startsWith('ko')) {
    charPattern = /[\uAC00-\uD7AF]/; // 한글
  } else if (targetLangCode.startsWith('zh')) {
    charPattern = /[\u4E00-\u9FFF]/; // 한자
  }

  if (!charPattern) return text; // 라틴 계열은 후처리 없이 반환

  // 전략1: 따옴표 안의 타겟 언어 텍스트 중 마지막/가장 긴 것
  const quoteRe = /["""「『]([\s\S]*?)["""」』]/g;
  const quoted = [...text.matchAll(quoteRe)]
    .map((m) => m[1].trim())
    .filter((s) => charPattern!.test(s));
  if (quoted.length > 0) {
    // 가장 긴 인용구 반환 (보통 "combined translation"이 마지막/가장 김)
    return quoted.reduce((a, b) => (b.length >= a.length ? b : a));
  }

  // 전략2: 타겟 언어 문자를 포함하는 문장만 추출
  const sentences = text
    .split(/(?<=[。.!?！？\n])/)
    .map((s) => s.trim())
    .filter((s) => charPattern!.test(s));
  if (sentences.length > 0) return sentences.join(' ');

  return text;
}

// ── 장치 뱃지 (자동 설정 완료 시 표시) ─────────
function DeviceBadge({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-zinc-200 rounded-lg">
      <span className="text-xs">{icon}</span>
      <span className="text-[10px] text-zinc-400">{label}</span>
      <span className="text-[11px] font-medium text-zinc-700 max-w-[140px] truncate">{value}</span>
    </div>
  );
}

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

// ─────────────────────────────────────────────
// Gemini Live 상태 시각화 — 파동 애니메이션
// ─────────────────────────────────────────────
const LIVE_VOICES = [
  { name: 'Aoede',  label: 'Aoede — 밝은 여성' },
  { name: 'Puck',   label: 'Puck — 경쾌한 남성' },
  { name: 'Charon', label: 'Charon — 차분한 남성' },
  { name: 'Fenrir', label: 'Fenrir — 낮고 강한 남성' },
  { name: 'Kore',   label: 'Kore — 차분한 여성' },
  { name: 'Zephyr', label: 'Zephyr — 부드러운 중성' },
] as const;
type LivePhase = 'listening' | 'processing' | 'speaking';

function LiveStatusIndicator({ phase }: { phase: LivePhase }) {
  if (phase === 'processing') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-4 h-4 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
      </div>
    );
  }
  const count = phase === 'speaking' ? 5 : 3;
  const heights = phase === 'speaking' ? [6, 14, 22, 14, 6] : [6, 12, 6];
  const color   = phase === 'speaking' ? 'bg-green-500' : 'bg-blue-400';
  const speed   = phase === 'speaking' ? '0.55s' : '1s';
  return (
    <div className="flex items-end gap-[3px] h-6">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-full ${color} animate-bounce`}
          style={{ height: `${heights[i]}px`, animationDelay: `${i * 0.1}s`, animationDuration: speed }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Gemini Live 통역 패널
// ─────────────────────────────────────────────
function GeminiLivePanel({
  wsState,
  liveActive,
  livePhase,
  liveVoice,
  liveError,
  liveCustomTTS,
  vadSpeed,
  onStart,
  onStop,
  onVoiceChange,
  onCustomTTSChange,
  onVadSpeedChange,
}: {
  wsState: 'disconnected' | 'connecting' | 'ready' | 'error';
  liveActive: boolean;
  livePhase: LivePhase;
  liveVoice: string;
  liveError: string | null;
  liveCustomTTS: boolean;
  vadSpeed: 'fast' | 'balanced' | 'accurate';
  onStart: () => void;
  onStop: () => void;
  onVoiceChange: (v: string) => void;
  onCustomTTSChange: (enabled: boolean) => void;
  onVadSpeedChange: (speed: 'fast' | 'balanced' | 'accurate') => void;
}) {
  const isConnecting = wsState === 'connecting';

  const dotColor =
    !liveActive                  ? 'bg-zinc-300'
    : livePhase === 'speaking'   ? 'bg-green-500 animate-pulse'
    : livePhase === 'processing' ? 'bg-amber-500 animate-pulse'
    :                              'bg-blue-500 animate-pulse';

  const phaseLabel =
    livePhase === 'speaking'   ? (liveCustomTTS ? '커스텀 TTS 재생 중' : '통역 재생 중')
    : livePhase === 'processing' ? 'Gemini에 전달 중...'
    :                              '상대방 음성 대기 중...';

  return (
    <div className={`rounded-2xl border px-4 py-3 transition-colors ${
      liveActive ? 'bg-indigo-50 border-indigo-200' : 'bg-zinc-50 border-zinc-200'
    }`}>
      <div className="flex items-center gap-3 flex-wrap">

        {/* 배지 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className="text-xs font-semibold text-zinc-700">Gemini Live</span>
          <span className="text-[10px] font-medium text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full">Beta</span>
        </div>

        {/* 상태 애니메이션 (활성 시만) */}
        {liveActive && (
          <div className="flex items-center gap-2">
            <LiveStatusIndicator phase={livePhase} />
            <span className="text-xs text-zinc-500">{phaseLabel}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* TTS 출력 모드 세그먼트 컨트롤 */}
        <div className="flex items-center shrink-0 bg-zinc-100 rounded-xl p-0.5 gap-0.5">
          <button
            onClick={() => onCustomTTSChange(false)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              !liveCustomTTS
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            ⚡ 초저지연
          </button>
          <button
            onClick={() => onCustomTTSChange(true)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
              liveCustomTTS
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            🎧 프리미엄
          </button>
        </div>

        {/* 음성 선택 (초저지연 모드에서만 표시) */}
        {!liveCustomTTS && (
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-xs text-zinc-400">음성</label>
            <select
              value={liveVoice}
              onChange={(e) => onVoiceChange(e.target.value)}
              disabled={liveActive}
              className="h-8 px-2 text-xs bg-white border border-zinc-200 rounded-lg text-zinc-700 focus:outline-none disabled:opacity-50 cursor-pointer"
            >
              {LIVE_VOICES.map((v) => <option key={v.name} value={v.name}>{v.label}</option>)}
            </select>
          </div>
        )}

        {/* 반응 속도 */}
        <div className="flex flex-col gap-1 shrink-0">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-zinc-400">속도</label>
            <div className="flex rounded-lg border border-zinc-200 overflow-hidden text-xs">
              {(['fast', 'balanced', 'accurate'] as const).map((s) => (
                <button
                  key={s}
                  disabled={liveActive}
                  onClick={() => onVadSpeedChange(s)}
                  className={`px-2.5 py-1 transition-colors disabled:opacity-50 ${
                    vadSpeed === s
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white text-zinc-500 hover:bg-zinc-50'
                  }`}
                >
                  {s === 'fast' ? '빠름' : s === 'balanced' ? '보통' : '정확'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 leading-tight">
            {vadSpeed === 'fast'     && '말이 끝나면 즉시 전송 — 짧은 발화에 최적'}
            {vadSpeed === 'balanced' && '속도와 안정성의 균형 — 대부분의 환경에 권장'}
            {vadSpeed === 'accurate' && '긴 문장도 끊기지 않게 — 느리지만 정확'}
          </p>
        </div>

        {/* 프리미엄 모드 안내 레이블 */}
        {liveCustomTTS && (
          <span className="text-[11px] text-violet-600 bg-violet-50 border border-violet-200 px-2.5 py-1.5 rounded-xl shrink-0">
            커스텀 TTS 모드
          </span>
        )}

        {/* 시작 / 정지 버튼 */}
        {!liveActive ? (
          <button
            onClick={onStart}
            disabled={isConnecting}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-medium rounded-xl transition-colors shrink-0 shadow shadow-indigo-600/20"
          >
            {isConnecting ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                연결 중...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm6 10a1 1 0 0 0-2 0 4 4 0 0 1-8 0 1 1 0 0 0-2 0 6 6 0 0 0 5 5.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A6 6 0 0 0 18 11z"/>
                </svg>
                Live 시작
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-xl transition-colors shrink-0 shadow shadow-red-500/20"
          >
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            정지
          </button>
        )}
      </div>

      {/* 인라인 에러 */}
      {liveError && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 leading-relaxed">
          ⚠ {liveError}
        </div>
      )}
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
  const geminiLive = useGeminiLive();
  const autoAudio = useAutoAudioSetup();
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
  const [showAdvancedDevices, setShowAdvancedDevices] = useState(false);
  const [ttsEngine, setTtsEngine] = useState<TTSEngine>('edge');
  const [ttsVoice, setTtsVoice] = useState('ko-KR-SunHiNeural'); // localStorage에서 복원
  const [ttsRate, setTtsRate] = useState(1.0);       // 말하기 속도 — localStorage에서 복원
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');  // ElevenLabs API 키

  // ── ElevenLabs 동적 보이스 패치 상태 ──────────
  const [elVoices, setElVoices] = useState<{ id: string; label: string; previewUrl?: string }[]>(ELEVENLABS_VOICE_PRESETS);
  const [elVoicesLoading, setElVoicesLoading] = useState(false);
  const [elVoicesError, setElVoicesError] = useState<string | null>(null);
  const elFetchedKeyRef = useRef<string>(''); // 중복 패치 방지

  // ── ElevenLabs 보이스 미리 듣기 상태 ──────────
  const [elPreviewState, setElPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [micLevel, setMicLevel] = useState(0);
  const levelRafRef = useRef<number>(0);
  const [cableDetected, setCableDetected] = useState(false);

  // ── VAD 반응 속도 프리셋 ─────────────────────
  type VADSpeed = 'fast' | 'balanced' | 'accurate';
  const VAD_SPEED_PRESETS: Record<VADSpeed, { redemptionMs: number; negativeSpeechThreshold: number; minSpeechMs: number }> = {
    fast:     { redemptionMs: 300,  negativeSpeechThreshold: 0.50, minSpeechMs: 100 },
    balanced: { redemptionMs: 400,  negativeSpeechThreshold: 0.45, minSpeechMs: 150 },
    accurate: { redemptionMs: 800,  negativeSpeechThreshold: 0.35, minSpeechMs: 250 },
  };
  const [vadSpeed, setVadSpeed] = useState<VADSpeed>('balanced');

  // ── Gemini Live V2 파이프라인 상태 ────────────
  const [liveActive, setLiveActive] = useState(false);
  const [liveVoice, setLiveVoice] = useState('Aoede');
  const [liveToast, setLiveToast] = useState<string | null>(null);
  // VAD 발화 감지 중 (onSpeechStart → onSpeechEnd 구간)
  const [isVADProcessing, setIsVADProcessing] = useState(false);
  // Gemini 응답 오디오 재생 중 (muteUntilRef 폴링으로 감지)
  const [isSpeakingLive, setIsSpeakingLive] = useState(false);
  // VAD 정리 함수 ref
  const stopLiveVADRef = useRef<(() => void) | null>(null);
  // 'ready' 상태가 되면 VAD를 한 번만 시작하기 위한 플래그
  const liveStartedRef = useRef(false);
  // 최초 'ready' 도달 여부 — setLiveActive(true) 리렌더링 시 state='disconnected'에서
  // useEffect cleanup 분기가 조기 실행되는 것을 방지하는 핵심 가드
  const liveWasReadyRef = useRef(false);
  // TTS 출력 모드: false = 초저지연(Gemini PCM), true = 프리미엄(커스텀 TTS)
  const [liveCustomTTS, setLiveCustomTTS] = useState(false);
  // V2 실시간 자막 (turnComplete 시 Gemini 텍스트 파트 수집)
  const [liveSubtitles, setLiveSubtitles] = useState<Array<{ id: string; text: string; timestamp: number }>>([]);
  // 커스텀 TTS 콜백에서 최신 TTS 파라미터를 읽기 위한 Ref (stale closure 방지)
  const liveCustomTTSParamsRef = useRef({ ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang });
  // 커스텀 TTS 콜백 Ref — 항상 최신 paramsRef를 통해 읽음
  const liveCustomTTSCallbackRef = useRef<(text: string) => void>(() => {});

  // ── Electron 환경 감지 (마운트 시 1회) ──────
  useEffect(() => {
    const detected = !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
    setIsElectron(detected);
  }, []);

  // ── TTS 엔진·음성·속도 설정 복원 ──────────────
  useEffect(() => {
    const defaultVoices: Record<TTSEngine, string> = {
      edge: 'ko-KR-SunHiNeural',
      elevenlabs: '21m00Tcm4TlvDq8ikWAM',
      gemini: 'Aoede',
    };
    const savedEngine = (localStorage.getItem('ttsEngine') ?? 'edge') as TTSEngine;
    setTtsEngine(savedEngine);

    const savedVoice = localStorage.getItem(`ttsVoice_${savedEngine}`);
    setTtsVoice(savedVoice ?? defaultVoices[savedEngine]);

    const savedRate = parseFloat(localStorage.getItem('ttsRate') ?? '');
    if (!isNaN(savedRate) && savedRate >= 0.5 && savedRate <= 2.0) setTtsRate(savedRate);

    if (localStorage.getItem('liveCustomTTS') === '1') setLiveCustomTTS(true);

    // ElevenLabs 키는 userId 확정 후 loadUserSettings()에서 로드 (아래 인증 useEffect)
  }, []);

  // ── 커스텀 TTS 파라미터 Ref 동기화 ───────────
  useEffect(() => {
    liveCustomTTSParamsRef.current = { ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang };
  }, [ttsEngine, ttsVoice, ttsRate, elevenLabsApiKey, apiKey, micLang]);

  // ── 커스텀 TTS 콜백 초기화 (마운트 시 1회) ────
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
          const fallbackVoice = defaultEdgeVoiceForLang(micLang as import('@/lib/stt').STTLanguage);
          audioBuffer = await synthesizeEdgeTTS(text, fallbackVoice, ttsRate);
        } catch { /* Edge TTS도 실패 — 무음으로 진행 */ }
      }

      if (audioBuffer) {
        const estimatedMs = (audioBuffer.byteLength / 6000) * 1000 + 5000;
        geminiLive.setMuteUntil(Date.now() + estimatedMs);
        await pipeline.playBlobToEarphone(new Blob([audioBuffer], { type: 'audio/mp3' }));
        geminiLive.setMuteUntil(Date.now() + 5000); // 재생 후 5초 추가 뮤트
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 마운트 시 1회 — 내부에서 ref 직접 참조

  // ── Gemini Live 자막 콜백 등록 (마운트 시 1회) ──────────────
  useEffect(() => {
    geminiLive.setSubtitleCallback((text: string) => {
      const clean = extractTranslation(text, liveCustomTTSParamsRef.current.micLang);
      setLiveSubtitles((prev) => [
        ...prev.slice(-49),
        { id: `${Date.now()}-${Math.random()}`, text: clean, timestamp: Date.now() },
      ]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── V2 자막 자동 스크롤 ──────────────────────────────────
  useEffect(() => {
    if (liveSubtitles.length > 0) {
      subtitleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveSubtitles]);

  // ── ElevenLabs 보이스 동적 패치 ──────────────
  // 조건: ElevenLabs 엔진 선택 + 유효한 API 키 입력
  // 동일 키로 중복 패치 방지 (elFetchedKeyRef)
  useEffect(() => {
    if (ttsEngine !== 'elevenlabs' || !elevenLabsApiKey.trim()) return;
    if (elFetchedKeyRef.current === elevenLabsApiKey) return; // 이미 패치한 키

    let cancelled = false;
    setElVoicesLoading(true);
    setElVoicesError(null);

    fetchElevenLabsVoices(elevenLabsApiKey)
      .then((voices: ElevenLabsVoice[]) => {
        if (cancelled) return;
        elFetchedKeyRef.current = elevenLabsApiKey;
        const mapped = voices.map((v) => ({ id: v.voice_id, label: buildElevenLabsLabel(v), previewUrl: v.preview_url }));
        setElVoices(mapped);
        // 현재 선택된 voice_id가 새 목록에 없으면 첫 번째 항목으로 리셋
        if (mapped.length > 0 && !mapped.some((v) => v.id === ttsVoice)) {
          setTtsVoice(mapped[0].id);
          localStorage.setItem('ttsVoice_elevenlabs', mapped[0].id);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const msg = `ElevenLabs 보이스 로드 실패: ${err.message}`;
        setElVoicesError(msg);
        setElVoices(ELEVENLABS_VOICE_PRESETS); // 하드코딩 프리셋 폴백
      })
      .finally(() => { if (!cancelled) setElVoicesLoading(false); });

    return () => { cancelled = true; };
  }, [ttsEngine, elevenLabsApiKey]); // ttsVoice는 의도적으로 제외 (패치 트리거 아님)

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

  // ── 자동 오디오 설정 결과 → device state 반영 ──────────
  useEffect(() => {
    if (autoAudio.state !== 'ready') return;
    setMicDeviceId(autoAudio.micId);
    setVirtualMicDeviceId(autoAudio.virtualMicId);
    setEarphoneDeviceId(autoAudio.earphoneId);
    pipeline.setVirtualMicDevice(autoAudio.virtualMicId);
    pipeline.setEarphoneDevice(autoAudio.earphoneId);
    setCableDetected(true);
    setVirtualCableReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAudio.state, autoAudio.micId, autoAudio.virtualMicId, autoAudio.earphoneId]);

  // ── 음성 레벨 업데이트 ──────────────────────
  const updateLevels = useCallback(() => {
    if (liveActive) setMicLevel(pipeline.getMicLevel());
    levelRafRef.current = requestAnimationFrame(updateLevels);
  }, [pipeline, liveActive]);

  useEffect(() => {
    levelRafRef.current = requestAnimationFrame(updateLevels);
    return () => cancelAnimationFrame(levelRafRef.current);
  }, [updateLevels]);

  // ── 로그아웃 ────────────────────────────────
  async function handleLogout() {
    // 메모리에 올라간 API 키 즉시 초기화 — 다음 사용자가 볼 수 없도록
    stopPreview();
    setElevenLabsApiKey('');
    elFetchedKeyRef.current = ''; // 다음 로그인 시 새 키로 재패치 허용
    setElVoices(ELEVENLABS_VOICE_PRESETS); // 동적 목록 초기화
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // ── ElevenLabs 미리 듣기 제어 ──────────────────
  function stopPreview() {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    setElPreviewState('idle');
  }

  async function handlePreview() {
    const voice = elVoices.find((v) => v.id === ttsVoice);
    if (!voice?.previewUrl) return;

    if (elPreviewState === 'playing') {
      stopPreview();
      return;
    }

    stopPreview();
    setElPreviewState('loading');

    const audio = new Audio(voice.previewUrl);
    previewAudioRef.current = audio;

    // ── 핵심: 이어폰 출력 장치로 명시적 고정 ──────────────
    // VB-Cable(가상 마이크)로 라우팅되지 않도록
    // earphoneDeviceId가 'default'이면 빈 문자열(시스템 기본값)로 설정
    const sinkId = earphoneDeviceId !== 'default' ? earphoneDeviceId : '';
    if (typeof (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId === 'function') {
      try {
        await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(sinkId);
      } catch { /* setSinkId 실패 시 시스템 기본값으로 폴백 */ }
    }

    audio.oncanplay = () => setElPreviewState('playing');
    audio.onended = () => { previewAudioRef.current = null; setElPreviewState('idle'); };
    audio.onerror = () => { previewAudioRef.current = null; setElPreviewState('idle'); };

    try {
      await audio.play();
    } catch {
      previewAudioRef.current = null;
      setElPreviewState('idle');
    }
  }

  // ── Gemini Live: TTS 출력 모드 전환 ─────────────────────────
  function handleCustomTTSToggle(enabled: boolean) {
    setLiveCustomTTS(enabled);
    localStorage.setItem('liveCustomTTS', enabled ? '1' : '0');
    if (enabled) {
      geminiLive.enableCustomTTS(liveCustomTTSCallbackRef.current);
    } else {
      geminiLive.disableCustomTTS();
    }
  }

  // ── TTS 엔진 변경 ────────────────────────────
  function handleEngineChange(engine: TTSEngine) {
    const defaultVoices: Record<TTSEngine, string> = {
      edge: 'ko-KR-SunHiNeural',
      elevenlabs: '21m00Tcm4TlvDq8ikWAM',
      gemini: 'Aoede',
    };
    setTtsEngine(engine);
    localStorage.setItem('ttsEngine', engine);
    const savedVoice = localStorage.getItem(`ttsVoice_${engine}`);
    const voice = savedVoice ?? defaultVoices[engine];
    setTtsVoice(voice);
  }

  // ── Gemini Live: speaking 상태 폴링 (RAF) ───────────────
  // muteUntilRef는 렌더를 트리거하지 않으므로 RAF로 직접 polling
  useEffect(() => {
    if (!liveActive) { setIsSpeakingLive(false); return; }
    let rafId: number;
    const poll = () => {
      setIsSpeakingLive(Date.now() < geminiLive.muteUntilRef.current);
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [liveActive, geminiLive.muteUntilRef]);

  // ── Gemini Live: WS 상태 변화 감지 ──────────────────────
  // 'ready' → VAD 시작 / 'error' → 토스트 + 정리 / 예상치 못한 'disconnected' → 정리
  useEffect(() => {
    if (!liveStartedRef.current) return;

    if (geminiLive.state === 'ready' && !stopLiveVADRef.current) {
      // WS 연결 완료 → Silero VAD 시작
      liveWasReadyRef.current = true; // 최초 ready 도달 표시
      // 임시 noop을 즉시 등록해 async 완료 전 중복 실행 방지 (race condition)
      stopLiveVADRef.current = () => {};
      pipeline.startVADWeb(
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
    }

    if (geminiLive.state === 'error') {
      setLiveToast(geminiLive.error ?? 'Gemini Live 연결 오류 — API 키와 네트워크를 확인하세요');
      liveStartedRef.current = false;
      setLiveActive(false);
      setIsVADProcessing(false);
    }

    if (geminiLive.state === 'disconnected' && liveWasReadyRef.current) {
      // ready 이후 예상치 못한 연결 끊김만 처리
      // (connect() 전 setLiveActive(true) 리렌더링 시 state='disconnected' 오발 방지)
      setLiveToast('Gemini Live 연결이 끊겼습니다. 다시 시작해 주세요.');
      liveWasReadyRef.current = false;
      liveStartedRef.current = false;
      setLiveActive(false);
      stopLiveVADRef.current?.();
      stopLiveVADRef.current = null;
    }
    // pipeline.startVADWeb / geminiLive.sendAudioChunk 는 안정적인 useCallback refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiLive.state]);

  // ── Gemini Live: 토스트 자동 소거 ────────────────────────
  useEffect(() => {
    if (!liveToast) return;
    const t = setTimeout(() => setLiveToast(null), 6000);
    return () => clearTimeout(t);
  }, [liveToast]);

  // ── Gemini Live: 시작 ────────────────────────────────────
  async function handleLiveStart() {
    if (!apiKey) { setShowApiModal(true); return; }

    if (earphoneDeviceId === 'default') {
      setLiveToast('이어폰 장치를 먼저 선택해 주세요 — 하단 "이어폰 출력" 드롭다운을 확인하세요');
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
    const systemInstruction =
      `You are a silent translation engine. You do NOT speak. You do NOT explain. You do NOT greet. You do NOT use markdown.\n` +
      `TASK: When you hear speech, detect its language and output ONLY the translated text.\n` +
      `- If the speaker uses ${sourceLangLabel}: output the ${targetLangLabel} translation only.\n` +
      `- If the speaker uses ${targetLangLabel}: output the ${sourceLangLabel} translation only.\n` +
      `FORBIDDEN (instant failure if violated):\n` +
      `- Any meta-commentary ("Translating...", "The translation is...", "I've translated...")\n` +
      `- Any greeting, filler, explanation, or markdown formatting\n` +
      `- Any output that is not the raw translated sentence\n` +
      `OUTPUT FORMAT: [translated sentence only — nothing else]`;

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

  // ── Gemini Live: 정지 ────────────────────────────────────
  function handleLiveStop() {
    liveStartedRef.current = false;
    liveWasReadyRef.current = false;
    stopLiveVADRef.current?.();
    stopLiveVADRef.current = null;
    geminiLive.disconnect();
    geminiLive.disableCustomTTS(); // 커스텀 TTS 모드 초기화
    setLiveActive(false);
    setIsVADProcessing(false);
    setIsSpeakingLive(false);
    setLiveSubtitles([]);
  }

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

      {/* ElevenLabs 보이스 패치 에러 토스트 */}
      {elVoicesError && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[150] bg-red-700 text-white px-4 py-3 rounded-2xl shadow-2xl text-sm flex items-center gap-2 max-w-sm">
          <span className="text-base">🔑</span>
          <span>{elVoicesError} — 기본 프리셋으로 대체됩니다</span>
        </div>
      )}

      {/* Gemini Live 에러 / 경고 토스트 */}
      {liveToast && (
        <div className="fixed top-4 right-4 z-[150] bg-zinc-900 text-white px-4 py-3 rounded-2xl shadow-2xl text-sm flex items-center gap-2.5 max-w-xs animate-in slide-in-from-right-4">
          <span className="shrink-0 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center text-[10px] font-bold">!</span>
          <span className="leading-relaxed">{liveToast}</span>
        </div>
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
              liveActive ? 'bg-indigo-50 text-indigo-700' : 'bg-zinc-100 text-zinc-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${liveActive ? 'bg-indigo-500 animate-pulse' : 'bg-zinc-300'}`} />
              {liveActive ? 'Live 통역 중' : '대기'}
            </div>
          </div>

          {/* 언어 선택 */}
          <div className="flex items-center gap-2">
            <select
              value={micLang}
              onChange={(e) => setMicLang(e.target.value)}
              disabled={liveActive}
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
              disabled={liveActive}
              className="text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 transition disabled:opacity-50"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
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
              {liveActive ? (
                /* ── V2 실시간 자막 ── */
                liveSubtitles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4">
                    <LiveStatusIndicator phase={isSpeakingLive ? 'speaking' : isVADProcessing ? 'processing' : 'listening'} />
                    <p className="text-sm text-zinc-400">상대방 음성을 기다리는 중...</p>
                  </div>
                ) : (
                  <div className="space-y-3 py-2">
                    {liveSubtitles.map((s) => (
                      <div key={s.id} className="rounded-2xl p-4 bg-white border border-zinc-100 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs text-zinc-400">🎧 Gemini 통역</span>
                          <span className="text-[10px] text-zinc-300">
                            {new Date(s.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm font-medium leading-relaxed text-zinc-900">{s.text}</p>
                      </div>
                    ))}
                    <div ref={subtitleEndRef} />
                  </div>
                )
              ) : (
                /* ── 사용 가이드 ── */
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
                        icon: '🚀',
                        title: 'Gemini Live 시작',
                        desc: '상단 패널에서 [Live 시작] 버튼을 누르세요',
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

          {/* Gemini Live V2 통역 패널 */}
          <div className="mb-4">
            <GeminiLivePanel
              wsState={geminiLive.state}
              liveActive={liveActive}
              livePhase={
                isSpeakingLive   ? 'speaking'
                : isVADProcessing  ? 'processing'
                :                   'listening'
              }
              liveVoice={liveVoice}
              liveError={null}
              liveCustomTTS={liveCustomTTS}
              onStart={handleLiveStart}
              onStop={handleLiveStop}
              onVoiceChange={setLiveVoice}
              onCustomTTSChange={handleCustomTTSToggle}
              vadSpeed={vadSpeed}
              onVadSpeedChange={setVadSpeed}
            />
          </div>

          {/* ── 오디오 자동 설정 패널 ── */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex-1">

              {/* 스캔 중 */}
              {autoAudio.state === 'scanning' && (
                <div className="flex items-center gap-2.5 py-2.5 px-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
                  <svg className="animate-spin w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  <span className="text-sm text-zinc-500">오디오 장치 스캔 중...</span>
                </div>
              )}

              {/* 자동 설정 완료 */}
              {autoAudio.state === 'ready' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 py-2.5 px-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                    <span className="text-emerald-600 text-base">✅</span>
                    <span className="text-sm font-medium text-emerald-700">오디오 라우팅 자동 설정 완료</span>
                    <button
                      onClick={() => setShowAdvancedDevices((v) => !v)}
                      className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-600 underline underline-offset-2 transition-colors"
                    >
                      {showAdvancedDevices ? '접기' : '고급 설정'}
                    </button>
                  </div>

                  {/* 장치 뱃지 */}
                  <div className="flex gap-2 flex-wrap px-1">
                    <DeviceBadge icon="🎧" label="입력" value={autoAudio.labels.mic} />
                    <DeviceBadge icon="📡" label="송출" value={autoAudio.labels.virtualMic} />
                    <DeviceBadge icon="🔊" label="이어폰" value={autoAudio.labels.earphone} />
                  </div>

                  {/* 고급 설정 (수동 오버라이드) */}
                  {showAdvancedDevices && (
                    <div className="flex gap-3 flex-wrap pt-1 pl-1">
                      <DeviceSelector
                        label="마이크 입력"
                        devices={pipeline.devices.inputs}
                        value={micDeviceId}
                        onChange={(id) => { setMicDeviceId(id); pipeline.setMicDevice(id); }}
                      />
                      <DeviceSelector
                        label="가상 마이크 출력"
                        devices={pipeline.devices.outputs}
                        value={virtualMicDeviceId}
                        onChange={(id) => { setVirtualMicDeviceId(id); pipeline.setVirtualMicDevice(id); }}
                        requiresCable
                      />
                      <DeviceSelector
                        label="이어폰 출력"
                        devices={pipeline.devices.outputs}
                        value={earphoneDeviceId}
                        onChange={(id) => { setEarphoneDeviceId(id); pipeline.setEarphoneDevice(id); }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 가상 케이블 없음 */}
              {(autoAudio.state === 'no-cable' || autoAudio.state === 'error') && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 py-2.5 px-4 bg-amber-50 border border-amber-200 rounded-2xl">
                    <span className="text-amber-500 text-base">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-800">가상 오디오 케이블(VB-CABLE) 설치가 필요합니다</p>
                      <p className="text-[11px] text-amber-600 mt-0.5">Discord/Teams로 번역 음성을 전달하려면 VB-CABLE 드라이버가 필요해요</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => openExternal('https://vb-audio.com/Cable/')}
                        className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium"
                      >
                        설치하기
                      </button>
                      <button
                        onClick={autoAudio.rescan}
                        className="text-xs px-3 py-1.5 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                      >
                        재검사
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* 오른쪽: 마이크 레벨 */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-zinc-400">레벨</span>
              <LevelBar level={micLevel} color="bg-zinc-900" />
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
