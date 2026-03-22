'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

// Google OAuth 콜백 처리 (클라이언트 컴포넌트)
// - 웹: 브라우저 리디렉션 후 이 페이지에서 code 교환
// - Electron: talksync:// 딥링크로 처리 → 이 페이지는 Electron에서 호출되지 않음
// output: 'export' 정적 빌드와 완전 호환
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    async function handleCallback() {
      try {
        const supabase = getSupabaseClient();
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');

        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch {
        // 코드 교환 실패 시에도 스튜디오로 이동 (로그인 상태 확인은 studio에서 처리)
      } finally {
        router.replace('/studio');
      }
    }

    handleCallback();
  }, [router]);

  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
        <p className="text-sm text-zinc-400">로그인 처리 중...</p>
      </div>
    </div>
  );
}
