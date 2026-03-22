import 'server-only';

import ko from '../../../messages/ko.json';
import en from '../../../messages/en.json';
import zh from '../../../messages/zh.json';
import de from '../../../messages/de.json';

export type { Locale } from '@/i18n/locales';
export { LOCALES, hasLocale } from '@/i18n/locales';

const dictionaries = { ko, en, zh, de } as const;

export type Dict = typeof ko;

export const getDictionary = (locale: string): Dict => {
  const key = locale as keyof typeof dictionaries;
  return dictionaries[key] ?? dictionaries.ko;
};
