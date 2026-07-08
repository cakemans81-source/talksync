export const GEMINI_LIVE_TRANSLATE_MODEL_ID = 'gemini-3.5-live-translate-preview';

export const GEMINI_LIVE_TRANSLATE_MODEL = `models/${GEMINI_LIVE_TRANSLATE_MODEL_ID}`;

export const GEMINI_LIVE_TRANSLATE_DISPLAY_NAME = 'Gemini Live Translate';

export const GEMINI_LIVE_TRANSLATE_UNAVAILABLE_MESSAGE =
  'Gemini Live Translate 모델을 사용할 수 없습니다. API key 권한 또는 모델 접근 권한을 확인하세요.';

export const GEMINI_LIVE_TRANSLATE_CONTEXT_WINDOW_COMPRESSION = {
  triggerTokens: 0,
  slidingWindow: {
    targetTokens: 0,
  },
} as const;

const GEMINI_LIVE_TRANSLATE_LANGUAGE_CODE_MAP: Record<string, string> = {
  'ko-KR': 'ko',
  'en-US': 'en',
  'en-GB': 'en',
  'ja-JP': 'ja',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'es-ES': 'es',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'vi-VN': 'vi',
};

export function toGeminiLiveTranslateLanguageCode(languageCode: string): string {
  const normalized = languageCode.trim();
  if (GEMINI_LIVE_TRANSLATE_LANGUAGE_CODE_MAP[normalized]) {
    return GEMINI_LIVE_TRANSLATE_LANGUAGE_CODE_MAP[normalized];
  }

  return normalized.split('-')[0]?.toLowerCase() || 'en';
}
