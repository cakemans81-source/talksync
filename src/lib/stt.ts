// ─────────────────────────────────────────────
// 지원 언어 목록 (BCP-47 코드)
//
// 레거시 STT 파이프라인(Web Speech / Gemini 전사)은 제거됨.
// 현재는 Gemini Live Translate 세션의 언어 선택 UI에서만 사용.
// ─────────────────────────────────────────────

export type STTLanguage = string;

export const SUPPORTED_LANGUAGES: { code: STTLanguage; label: string; flag: string }[] = [
  { code: 'ko-KR', label: '한국어', flag: '🇰🇷' },
  { code: 'en-US', label: 'English (US)', flag: '🇺🇸' },
  { code: 'en-GB', label: 'English (UK)', flag: '🇬🇧' },
  { code: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', label: '中文 (简体)', flag: '🇨🇳' },
  { code: 'zh-TW', label: '中文 (繁體)', flag: '🇹🇼' },
  { code: 'es-ES', label: 'Español', flag: '🇪🇸' },
  { code: 'fr-FR', label: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'vi-VN', label: 'Tiếng Việt', flag: '🇻🇳' },
];
