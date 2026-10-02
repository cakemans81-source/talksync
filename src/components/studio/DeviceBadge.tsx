// ── 장치 뱃지 (자동 설정 완료 시 표시) ─────────
export function DeviceBadge({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-zinc-200 rounded-lg">
      <span className="text-xs">{icon}</span>
      <span className="text-[10px] text-zinc-400">{label}</span>
      <span className="text-[11px] font-medium text-zinc-700 max-w-[140px] truncate">{value}</span>
    </div>
  );
}
