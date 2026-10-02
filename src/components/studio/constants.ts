import { VAD_TRANSLATION_PRESETS, type VADPreset } from '@/lib/systemAudioCapture';
import type { TTSEngine } from '@/lib/tts';

export { VIRTUAL_AUDIO_DRIVER_URL } from '@/lib/release';

// 웹 환경(비 Electron) — dev localhost에서만 Browser Tab capture smoke 허용
export const ENABLE_BROWSER_TAB_CAPTURE_WEB_DEV = process.env.NODE_ENV === 'development';
export const DRIVER_CHECK_TIMEOUT_MS = 2500;

// TTS 엔진별 기본 음성 (저장된 음성이 없을 때 사용)
export const DEFAULT_TTS_VOICES: Record<TTSEngine, string> = {
  edge: 'ko-KR-SunHiNeural',
  elevenlabs: '21m00Tcm4TlvDq8ikWAM',
  gemini: 'Aoede',
};

// ── VAD 반응 속도 프리셋 (통번역 최적화 — systemAudioCapture.ts 정의)
// rmsTimeoutMs = redemptionMs + 200ms 동적 공식으로 폴백 하드코딩 문제 해결
export type VADSpeed = VADPreset;
export const VAD_SPEED_PRESETS = VAD_TRANSLATION_PRESETS;

// V2 실시간 자막 항목
export type LiveSubtitle = { id: string; text: string; timestamp: number };
