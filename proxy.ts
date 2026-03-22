import createMiddleware from 'next-intl/middleware';
import { type NextRequest } from 'next/server';

const LOCALES = ['ko', 'en', 'zh', 'de'] as const;

const intlProxy = createMiddleware({
  locales: LOCALES,
  defaultLocale: 'ko',
  localePrefix: 'always',
});

export function proxy(request: NextRequest) {
  return intlProxy(request);
}

export const config = {
  // i18n 라우팅 대상: 루트(/) 및 locale 세그먼트만
  // studio, login, signup, auth, _next, api, 정적 파일 제외
  matcher: [
    '/',
    '/(ko|en|zh|de)/:path*',
    '/((?!studio|login|signup|auth|api|_next|favicon|.*\\..*).*)',
  ],
};
