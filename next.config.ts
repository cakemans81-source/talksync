import type { NextConfig } from "next";

const isElectronBuild = process.env.ELECTRON_BUILD === 'true';

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Electron 빌드: next export (out/ 폴더 → electron-builder 패키징)
  // Vercel/웹 빌드: 기본 서버 렌더링 모드 유지
  ...(isElectronBuild && {
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
  }),

  // Vercel 환경에서 electron 패키지를 번들에 포함시키지 않도록 외부 처리
  // (electron은 Node.js 메인 프로세스 전용 — 렌더러/Next.js 번들에 포함되면 빌드 에러)
  serverExternalPackages: ['electron'],
};

export default nextConfig;
