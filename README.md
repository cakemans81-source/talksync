# TalkSync

Windows에서 브라우저 탭·회의 앱·Discord 등의 오디오를 실시간으로 번역하는 음성 통역 앱 (Next.js 웹 + Electron 데스크톱).

## 스택

- Next.js 16 (App Router, 자체 딕셔너리 i18n: `messages/*.json`) / React 19 / Tailwind CSS 4
- Electron 34 + electron-builder (Windows NSIS 인스톨러)
- Gemini Live (`@google/generative-ai`), VAD (`@ricky0123/vad-web`), Supabase

## 주요 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | Next.js 개발 서버 (http://localhost:3000) |
| `npm run electron:dev` | 개발 서버 + Electron 동시 실행 |
| `npm run build:app` | Electron용 정적 빌드(`out/`) + 메인 프로세스 컴파일 |
| `npm run package:all` | `build:app` 후 Windows 인스톨러 생성 (`dist-electron/`) |
| `npm test` | Isolation hard-gate 테스트 |
| `npm run lint` | ESLint |

## 디렉터리

```
electron/       Electron 메인/프리로드 프로세스
src/app/        Next.js 라우트 (landing [locale], studio, auth 등)
src/hooks/      오디오 캡처·라우팅·Gemini Live 훅
src/lib/        공용 로직 (릴리스 URL, isolation hard-gate 등)
src/components/ UI 컴포넌트 (audio, landing)
messages/       다국어 문구 (ko, en, zh, de)
docs/           기획·릴리스·드라이버 문서
scripts/        서명·릴리스 빌드·드라이버 관련 스크립트
```

## 문서

기획·진행 상태의 기준 문서: `docs/MASTER_CONTEXT.md`

릴리스/서명 절차: `docs/release/`
