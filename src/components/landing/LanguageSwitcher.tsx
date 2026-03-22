'use client';

import { useRouter, usePathname } from 'next/navigation';
import { LOCALES, type Locale } from '@/i18n/locales';

const LOCALE_LABELS: Record<Locale, string> = {
  ko: '한국어',
  en: 'English',
  zh: '中文',
  de: 'Deutsch',
};

export function LanguageSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Locale;
    // Replace current locale segment with new one
    const segments = pathname.split('/');
    segments[1] = next;
    router.push(segments.join('/') || `/${next}`);
  }

  return (
    <div className="flex items-center gap-1.5 font-headline font-extralight tracking-tight text-sm text-zinc-500">
      {/* Globe icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      <select
        value={current}
        onChange={handleChange}
        className="bg-transparent border-none outline-none text-sm font-headline font-extralight text-zinc-500 hover:text-[#111111] transition-colors cursor-pointer appearance-none pr-1"
        aria-label="Select language"
      >
        {LOCALES.map((loc) => (
          <option key={loc} value={loc}>
            {LOCALE_LABELS[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
