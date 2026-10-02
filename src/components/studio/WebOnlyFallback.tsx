import { WINDOWS_INSTALLER_URL } from '@/lib/release';

// ── 웹 환경 진입 차단 Fallback ────────────────
// Vercel/브라우저에서 /studio 직접 접근 시 전체 화면 안내 표시
// 데스크탑 앱(Electron)에서는 렌더링되지 않음

export function WebOnlyFallback() {
  return (
    <div className="fixed inset-0 z-[200] bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        {/* 아이콘 */}
        <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mx-auto mb-8">
          <span className="text-4xl">🎙</span>
        </div>

        <h1 className="text-2xl font-bold text-white mb-3 tracking-tight">TalkSync</h1>
        <p className="text-zinc-400 text-sm leading-relaxed mb-8">
          실시간 통역 기능은 <span className="text-white font-medium">Windows 데스크탑 앱</span>에서만 지원됩니다.<br />
          브라우저 환경에서는 시스템 오디오 캡처 및<br />Discord 연동이 불가능합니다.
        </p>

        {/* 다운로드 버튼 */}
        <a
          href={WINDOWS_INSTALLER_URL}
          className="inline-flex items-center gap-2.5 bg-white text-zinc-900 px-8 py-3.5 rounded-2xl font-semibold text-sm hover:bg-zinc-100 transition-colors mb-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
          </svg>
          Windows용 무료 다운로드
        </a>

        <p className="text-zinc-600 text-xs">
          설치 후 앱을 실행하고 Google 계정으로 로그인하세요
        </p>
      </div>
    </div>
  );
}
