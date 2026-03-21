import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Google OAuth 콜백 처리
// 흐름: Google 로그인 → Supabase → /auth/callback?code=xxx → /studio
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component에서의 set은 무시 가능
            }
          },
        },
      }
    );

    await supabase.auth.exchangeCodeForSession(code);
  }

  // 로그인 완료 → 스튜디오로 이동
  return NextResponse.redirect(new URL('/studio', request.url));
}
