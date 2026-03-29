// window.electronAPI 전역 타입 선언
// electron/preload.ts의 contextBridge.exposeInMainWorld 와 일치해야 함

interface ElectronAPI {
  isElectron: true;
  getSystemAudioSourceId: () => Promise<string | null>;
  openExternal: (url: string) => void;
  onOAuthCallback: (callback: (url: string) => void) => () => void;
  synthesizeTTS: (text: string, lang: string) => Promise<ArrayBuffer | null>;
  /** Windows 기본 오디오 출력을 TalkSync Virtual Audio Cable로 전환 (현재 장치 저장) */
  enableCableRouting: () => Promise<{ ok: boolean; reason?: string }>;
  /** 저장된 원래 오디오 출력 장치로 복원 */
  disableCableRouting: () => Promise<{ ok: boolean; reason?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
