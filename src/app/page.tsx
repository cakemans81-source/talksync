import LocalePage from './[locale]/page';

// 루트(/) — 기본 언어(ko) 랜딩을 그대로 렌더링 (리다이렉트 없음, 웹·Electron 정적 export 공통)
export default function Home() {
  return <LocalePage params={Promise.resolve({ locale: 'ko' })} />;
}
