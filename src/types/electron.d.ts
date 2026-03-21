// window.electronAPI 전역 타입 선언
// electron/preload.ts의 contextBridge.exposeInMainWorld 와 일치해야 함

interface ElectronAPI {
  isElectron: true;
  getSystemAudioSourceId: () => Promise<string | null>;
  openExternal: (url: string) => void;
  onOAuthCallback: (callback: (url: string) => void) => () => void;
  synthesizeTTS: (text: string, lang: string) => Promise<ArrayBuffer | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
