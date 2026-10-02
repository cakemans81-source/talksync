import { SUPPORTED_LANGUAGES } from '@/lib/stt';

// ── 헤더 (상태 뱃지 · 언어 선택 · API 키 · 로그아웃) ──────────
export function StudioHeader({
  liveActive, micLang, sysLang, apiKey,
  onMicLangChange, onSysLangChange, onOpenApiKey, onLogout,
}: {
  liveActive: boolean;
  micLang: string;
  sysLang: string;
  apiKey: string;
  onMicLangChange: (code: string) => void;
  onSysLangChange: (code: string) => void;
  onOpenApiKey: () => void;
  onLogout: () => void;
}) {
  return (
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
          onChange={(e) => onMicLangChange(e.target.value)}
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
          onChange={(e) => onSysLangChange(e.target.value)}
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
          onClick={onOpenApiKey}
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
          onClick={onLogout}
          className="text-xs text-zinc-400 hover:text-zinc-600 px-3 py-2 rounded-xl hover:bg-zinc-100 transition"
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}
