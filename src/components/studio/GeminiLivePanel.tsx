import { GEMINI_LIVE_TRANSLATE_DISPLAY_NAME } from '@/lib/geminiModels';

// ─────────────────────────────────────────────
// Gemini Live Translate 상태 시각화 — 파동 애니메이션
// ─────────────────────────────────────────────
export const LIVE_VOICES = [
  { name: 'Aoede',  label: 'Aoede — 밝은 여성' },
  { name: 'Puck',   label: 'Puck — 경쾌한 남성' },
  { name: 'Charon', label: 'Charon — 차분한 남성' },
  { name: 'Fenrir', label: 'Fenrir — 낮고 강한 남성' },
  { name: 'Kore',   label: 'Kore — 차분한 여성' },
  { name: 'Zephyr', label: 'Zephyr — 부드러운 중성' },
] as const;
export type LivePhase = 'listening' | 'processing' | 'speaking';

export function LiveStatusIndicator({ phase }: { phase: LivePhase }) {
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
// Gemini Live Translate 통역 패널
// ─────────────────────────────────────────────
export function GeminiLivePanel({
  wsState,
  liveActive,
  livePhase,
  liveVoice,
  liveError,
  txWarning = null,
  liveCustomTTS,
  vadSpeed,
  disabled = false,
  disabledReason,
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
  /** useGeminiLive().txError — TalkSync Tx 송출 장치 연결 실패 시 인라인 경고 */
  txWarning?: string | null;
  liveCustomTTS: boolean;
  vadSpeed: 'fast' | 'balanced' | 'accurate';
  disabled?: boolean;
  disabledReason?: string;
  onStart: () => void;
  onStop: () => void;
  onVoiceChange: (v: string) => void;
  onCustomTTSChange: (enabled: boolean) => void;
  onVadSpeedChange: (speed: 'fast' | 'balanced' | 'accurate') => void;
}) {
  const isConnecting = wsState === 'connecting';
  const startDisabled = isConnecting || disabled;

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
          <span className="text-xs font-semibold text-zinc-700">{GEMINI_LIVE_TRANSLATE_DISPLAY_NAME}</span>
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

        {disabled && disabledReason && !liveActive && (
          <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl shrink-0">
            {disabledReason}
          </span>
        )}

        {/* 시작 / 정지 버튼 */}
        {!liveActive ? (
          <button
            onClick={onStart}
            disabled={startDisabled}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-300 disabled:shadow-none text-white text-xs font-medium rounded-xl transition-colors shrink-0 shadow shadow-indigo-600/20"
          >
            {isConnecting ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                연결 중...
              </>
            ) : disabled ? (
              '격리 조건 미충족'
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm6 10a1 1 0 0 0-2 0 4 4 0 0 1-8 0 1 1 0 0 0-2 0 6 6 0 0 0 5 5.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A6 6 0 0 0 18 11z"/>
                </svg>
                Live Translate 시작
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

      {/* TalkSync Tx(회의방 송출) 실패 경고 — 세션은 동작하지만 상대방에게 번역 음성이 전달되지 않음 */}
      {liveActive && txWarning && (
        <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
          ⚠ {txWarning}
        </div>
      )}

      {/* 인라인 에러 */}
      {liveError && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 leading-relaxed">
          ⚠ {liveError}
        </div>
      )}
    </div>
  );
}
