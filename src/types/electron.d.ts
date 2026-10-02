// window.electronAPI 전역 타입 선언
// electron/preload.ts의 contextBridge.exposeInMainWorld 와 일치해야 함

interface ElectronAPI {
  isElectron: true;
  getSystemAudioSourceId: () => Promise<string | null>;
  openExternal: (url: string) => void;
  onOAuthCallback: (callback: (url: string) => void) => () => void;
  /** WAV 파일을 Downloads/TalkSync/ 에 저장 (main 프로세스) */
  saveWav: (buffer: ArrayBuffer, filename: string) => Promise<{ ok: boolean; path?: string; reason?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
