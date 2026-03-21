'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// OAuth 방식에서는 별도 회원가입 불필요 → 로그인 페이지로 리다이렉트
export default function SignupPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login');
  }, [router]);
  return null;
}
