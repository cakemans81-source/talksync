'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

type ElectronAPI = {
  isElectron: true;
  openExternal: (url: string) => void;
  onOAuthCallback: (cb: (url: string) => void) => () => void;
};

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGoogleLogin() {
    setLoading(true);
    setError('');
    try {
      const supabase = getSupabaseClient();
      const electronAPI = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;

      if (electronAPI?.isElectron) {
        // ── Electron: 외부 브라우저로 OAuth → 딥링크 콜백 수신 ──
        const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: 'talksync://auth/callback',
            skipBrowserRedirect: true,
          },
        });
        if (oauthError) throw oauthError;
        if (!data.url) throw new Error('OAuth URL을 가져오지 못했어요');

        electronAPI.openExternal(data.url);

        // 딥링크 콜백 대기
        const cleanup = electronAPI.onOAuthCallback(async (callbackUrl) => {
          cleanup();
          try {
            const url = new URL(callbackUrl);
            const code = url.searchParams.get('code');
            const hash = new URLSearchParams(url.hash.replace('#', ''));
            const accessToken = hash.get('access_token');
            const refreshToken = hash.get('refresh_token');

            if (code) {
              await supabase.auth.exchangeCodeForSession(code);
            } else if (accessToken && refreshToken) {
              await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            }
            router.replace('/studio');
          } catch (e) {
            setError(e instanceof Error ? e.message : '로그인 콜백 처리 실패');
            setLoading(false);
          }
        });
      } else {
        // ── 웹 브라우저: 기존 리디렉션 방식 ─────────────────────
        const { error: oauthError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (oauthError) throw oauthError;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인 실패');
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      {/* 로고 */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-zinc-900 rounded-2xl mb-4 shadow-lg shadow-zinc-900/20">
          <span className="text-white text-2xl">🎙</span>
        </div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">TalkSync</h1>
        <p className="text-zinc-400 text-sm mt-1.5">실시간 AI 양방향 음성 통역</p>
      </div>

      {/* 카드 */}
      <div className="bg-white/80 backdrop-blur-xl border border-white/60 shadow-2xl shadow-zinc-200/50 rounded-3xl p-8">
        <h2 className="text-lg font-semibold text-zinc-900 mb-1">시작하기</h2>
        <p className="text-sm text-zinc-400 mb-7">무료로 시작하세요. 신용카드 불필요.</p>

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Google OAuth 버튼 */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white hover:bg-gray-50 disabled:bg-gray-50 border border-zinc-200 hover:border-zinc-300 text-zinc-800 font-medium rounded-2xl transition-all duration-200 shadow-sm hover:shadow-md text-sm"
        >
          {loading ? (
            <span className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          {loading ? '연결 중...' : 'Google 계정으로 계속하기'}
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-zinc-100" />
          <span className="text-xs text-zinc-300">무료로 사용</span>
          <div className="flex-1 h-px bg-zinc-100" />
        </div>

        <ul className="space-y-2.5">
          {[
            '실시간 양방향 음성 통역',
            '내 Gemini API 키 사용 (무과금)',
            'Discord / Teams / Zoom 호환',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2.5 text-xs text-zinc-500">
              <span className="w-4 h-4 bg-zinc-100 rounded-full flex items-center justify-center flex-shrink-0 text-zinc-400">✓</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-center text-xs text-zinc-300 mt-6">
        로그인 시 서비스 이용약관 및 개인정보처리방침에 동의합니다
      </p>
    </div>
  );
}
