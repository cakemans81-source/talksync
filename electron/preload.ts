// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
type IpcRendererEvent = import('electron').IpcRendererEvent;

// ── 렌더러(Next.js)에 안전하게 노출할 Electron API ──────────────
// window.electronAPI 로 접근 가능
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true as const,

  // 시스템 오디오 소스 ID (desktopCapturer → main 프로세스)
  getSystemAudioSourceId: (): Promise<string | null> =>
    ipcRenderer.invoke('get-system-audio-source-id'),

  // Google OAuth URL을 외부 브라우저로 열기
  openExternal: (url: string): void => {
    ipcRenderer.send('open-external', url);
  },

  // Windows SAPI TTS: 텍스트 → WAV ArrayBuffer
  synthesizeTTS: (text: string, lang: string): Promise<ArrayBuffer | null> =>
    ipcRenderer.invoke('synthesize-tts', text, lang).then((buf: Buffer | null) => {
      if (!buf) return null;
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    }),

  // OAuth 딥링크 콜백 수신 (talksync://auth/callback?code=...)
  onOAuthCallback: (callback: (url: string) => void): (() => void) => {
    const handler = (_: IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('oauth-callback', handler);
    // 클린업 함수 반환
    return () => ipcRenderer.removeListener('oauth-callback', handler);
  },

  // Windows 기본 오디오 출력 → CABLE-B 전환 & 원본 복원
  enableCableRouting: (): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('audio:enable-cable-routing'),
  disableCableRouting: (): Promise<{ ok: boolean; reason?: string }> =>
    ipcRenderer.invoke('audio:disable-cable-routing'),
});
