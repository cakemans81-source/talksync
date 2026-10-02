'use client';

import { useEffect, useState } from 'react';
import { DRIVER_CHECK_TIMEOUT_MS } from './constants';
import { detectVirtualAudioDevice } from './detectVirtualAudioDevice';

// ── 가상 오디오 케이블 필수 설치 검사 (Electron 전용) ──────
// 웹 환경에서는 getDisplayMedia 폴백으로 시스템 오디오를 캡처하므로 검사 불필요
// Electron 여부는 window.electronAPI.isElectron으로 판별
// 반환값: null = 검사 전, setter는 자동 설정 결과(ready/hasVirtualRoute) 반영용
export function useVirtualCableCheck() {
  const [virtualCableReady, setVirtualCableReady] = useState<boolean | null>(null); // null = 검사 전

  useEffect(() => {
    if (virtualCableReady !== null) return;
    const isElectron = !!(window as Window & { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;
    if (!isElectron) {
      // window 기반 환경 감지는 마운트 후에만 가능 (SSR hydration mismatch 방지)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVirtualCableReady(true); // 웹 환경 → 검사 스킵, 즉시 통과
      return;
    }

    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setVirtualCableReady(false);
    }, DRIVER_CHECK_TIMEOUT_MS);

    detectVirtualAudioDevice()
      .then((found) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        setVirtualCableReady(found);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        setVirtualCableReady(false);
      });

    return () => {
      settled = true;
      window.clearTimeout(timeoutId);
    };
  }, [virtualCableReady]);

  return [virtualCableReady, setVirtualCableReady] as const;
}
