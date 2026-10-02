import type { IsolationHardGateResult } from '@/lib/isolationHardGate';

// ── P0 isolation preflight checklist ──
export function IsolationChecklist({ gate }: { gate: IsolationHardGateResult }) {
  return (
    <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-semibold text-zinc-700">원음 격리 사전 점검 (P0)</p>
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            gate.ok
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          {gate.ok ? '통과' : '차단'}
        </span>
      </div>
      <ul className="space-y-1.5">
        {gate.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <span className={check.pass ? 'text-emerald-600' : 'text-amber-600'}>
              {check.pass ? '✓' : '○'}
            </span>
            <span className={check.pass ? 'text-zinc-600' : 'text-zinc-800 font-medium'}>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
      {!gate.ok && gate.blockers.length > 0 && (
        <div className="mt-2 pt-2 border-t border-zinc-100 space-y-1">
          {gate.blockers.slice(0, 3).map((b) => (
            <p key={b.code} className="text-[11px] text-amber-700 leading-relaxed">
              · {b.message}
            </p>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-zinc-400 leading-relaxed">
        Browser Tab 듣기 모드는 드라이버 없이 가능합니다. 양방향 치환(상대에게 AI 음성만 송출)만 이 게이트를 통과해야 시작합니다.
      </p>
    </div>
  );
}
