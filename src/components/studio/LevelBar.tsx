'use client';

import { useEffect, useRef, type Ref } from 'react';

// ── 음성 레벨 바 ──────────────────────────────
export function LevelBar({
  level, color = 'bg-zinc-900', barRef,
}: {
  level: number;
  color?: string;
  /** 지정 시 부모가 style.width를 직접 갱신할 수 있음 (MicLevelMeter) */
  barRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden w-20">
      <div
        ref={barRef}
        className={`h-full ${color} transition-all duration-75 rounded-full`}
        style={{ width: `${Math.round(level * 100)}%` }}
      />
    </div>
  );
}

// ── 마이크 레벨 미터 (자체 RAF) ─────────────────
// 매 프레임 React state를 갱신하면 상위(StudioPage) 전체가 ~60fps로 리렌더링되므로
// active 동안에만 RAF를 돌리고 bar의 style.width를 ref로 직접 갱신한다.
// getLevel은 안정적인 함수여야 함 (useAudioRouter().getMicLevel)
export function MicLevelMeter({
  getLevel, active, color = 'bg-zinc-900',
}: {
  getLevel: () => number;
  active: boolean;
  color?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!active) {
      bar.style.width = '0%';
      return;
    }

    let rafId = 0;
    let lastWidth = '';
    const tick = () => {
      const width = `${Math.round(getLevel() * 100)}%`;
      if (width !== lastWidth) {
        bar.style.width = width;
        lastWidth = width;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      bar.style.width = '0%';
    };
  }, [getLevel, active]);

  // level=0 고정 — 실제 폭은 위 RAF가 직접 기록 (React는 동일 style 값을 다시 쓰지 않음)
  return <LevelBar level={0} color={color} barRef={barRef} />;
}
