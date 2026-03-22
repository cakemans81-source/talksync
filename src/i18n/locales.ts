export const LOCALES = ['ko', 'en', 'zh', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const hasLocale = (l: string): l is Locale => (LOCALES as readonly string[]).includes(l);
