// Electron shell.openExternal 래퍼 — 웹 환경에서는 window.open 폴백
export function openExternal(url: string) {
  const api = (window as Window & { electronAPI?: { openExternal: (u: string) => void } }).electronAPI;
  if (api?.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
