import type { Dict } from '@/app/[locale]/dictionaries';

// ── 다국어 dict를 받아 렌더링하는 버전 (i18n 랜딩 페이지용) ──
export function LocalizedTrustSection({ dict }: { dict: Dict['trust'] }) {
  return (
    <section className="py-32 px-8 max-w-[1440px] mx-auto">
      <div className="mb-20 flex flex-col md:flex-row md:justify-between md:items-end gap-6">
        <div>
          <p className="font-label text-xs tracking-widest text-primary uppercase mb-4">
            {dict.eyebrow}
          </p>
          <h2 className="font-headline text-4xl font-extralight tracking-tight text-on-background">
            {dict.headline}
          </h2>
        </div>
        <p className="font-body text-sm text-outline leading-relaxed max-w-sm md:text-right">
          {dict.subDesc}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#E5E5E5] mb-12">
        {dict.cards.map((card, i) => (
          <div
            key={i}
            className="p-10 border-b md:border-b-0 border-r-0 md:border-r border-[#E5E5E5] last:border-r-0 last:border-b-0 flex flex-col gap-5 group hover:bg-[#fafafa] transition-colors duration-300"
          >
            <div className="flex items-start justify-between">
              <span className="material-symbols-outlined text-primary text-3xl">{card.icon}</span>
              <span className="font-label text-[9px] tracking-widest uppercase bg-primary/10 text-primary px-2 py-1 leading-none">
                {card.badge}
              </span>
            </div>
            <div className="flex flex-col gap-3 flex-1">
              <h3 className="font-headline text-lg font-normal text-on-background">{card.title}</h3>
              <p className="font-body text-sm text-outline leading-relaxed">{card.desc}</p>
            </div>
            <div className="flex items-center gap-2 pt-4 border-t border-[#E5E5E5]">
              <div className="w-[1px] h-3 bg-primary opacity-60" />
              <span className="font-label text-[10px] tracking-wider text-outline uppercase">{card.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="w-full bg-zinc-950 px-10 py-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[400px] h-[200px] bg-primary blur-[80px] rounded-full" />
        </div>
        <div className="relative z-10 flex flex-col gap-2">
          <p className="font-label text-[10px] tracking-[0.4em] uppercase text-primary">{dict.bannerLabel}</p>
          <p className="font-headline text-xl font-light text-surface tracking-tight">{dict.bannerSlogan}</p>
        </div>
        <div className="relative z-10 flex flex-wrap items-center gap-3">
          {dict.tags.map((tag) => (
            <span key={tag} className="font-label text-[10px] uppercase tracking-wider border border-white/20 text-white/60 px-3 py-1.5 hover:border-primary hover:text-primary transition-colors duration-200">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── 한국어 하드코딩 버전 (기존 랜딩 page.tsx / Electron용) ──
const TRUST_CARDS = [
  {
    icon: 'key',
    badge: 'BYOK',
    title: '완벽한 키 격리',
    desc: 'API 키는 귀하의 기기 로컬 스토리지에만 저장됩니다. TalkSync 서버로 전송되거나 수집되는 일은 구조적으로 불가능합니다.',
    detail: 'localStorage → AES-256 암호화',
  },
  {
    icon: 'security',
    badge: 'ENTERPRISE',
    title: '엔터프라이즈급 앱 보안',
    desc: 'ASAR 아카이브 패킹과 소스코드 전면 난독화로 외부 변조를 원천 차단합니다. 배포 바이너리에는 원본 소스가 포함되지 않습니다.',
    detail: 'asar 패킹 + 코드 난독화',
  },
  {
    icon: 'noise_aware',
    badge: 'ZERO RETENTION',
    title: '투명한 데이터 처리',
    desc: '캡처된 오디오 데이터는 통역 즉시 메모리에서 휘발됩니다. 음성 녹음, 무단 수집, 제3자 전달은 일체 없습니다.',
    detail: '통역 후 즉시 메모리 해제',
  },
];

export function TrustSection() {
  return (
    <section className="py-32 px-8 max-w-[1440px] mx-auto">
      {/* 섹션 헤더 */}
      <div className="mb-20 flex flex-col md:flex-row md:justify-between md:items-end gap-6">
        <div>
          <p className="font-label text-xs tracking-widest text-primary uppercase mb-4">
            Trust &amp; Security
          </p>
          <h2 className="font-headline text-4xl font-extralight tracking-tight text-on-background">
            당신의 데이터,<br className="hidden md:block" /> 우리는 모릅니다.
          </h2>
        </div>
        <p className="font-body text-sm text-outline leading-relaxed max-w-sm md:text-right">
          TalkSync는 설계 단계부터 프라이버시를 핵심 원칙으로 삼습니다.
          어떠한 사용자 데이터도 서버에 기록되지 않습니다.
        </p>
      </div>

      {/* 3단 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#E5E5E5] mb-12">
        {TRUST_CARDS.map((card, i) => (
          <div
            key={i}
            className="p-10 border-b md:border-b-0 border-r-0 md:border-r border-[#E5E5E5] last:border-r-0 last:border-b-0 flex flex-col gap-5 group hover:bg-[#fafafa] transition-colors duration-300"
          >
            {/* 아이콘 + 배지 */}
            <div className="flex items-start justify-between">
              <span className="material-symbols-outlined text-primary text-3xl">
                {card.icon}
              </span>
              <span className="font-label text-[9px] tracking-widest uppercase bg-primary/10 text-primary px-2 py-1 leading-none">
                {card.badge}
              </span>
            </div>

            {/* 텍스트 */}
            <div className="flex flex-col gap-3 flex-1">
              <h3 className="font-headline text-lg font-normal text-on-background">
                {card.title}
              </h3>
              <p className="font-body text-sm text-outline leading-relaxed">
                {card.desc}
              </p>
            </div>

            {/* 기술 배지 */}
            <div className="flex items-center gap-2 pt-4 border-t border-[#E5E5E5]">
              <div className="w-[1px] h-3 bg-primary opacity-60" />
              <span className="font-label text-[10px] tracking-wider text-outline uppercase">
                {card.detail}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 하단 신뢰 배너 — 다크 미니 CTA */}
      <div className="w-full bg-zinc-950 px-10 py-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        {/* 배경 글로우 */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[400px] h-[200px] bg-primary blur-[80px] rounded-full" />
        </div>

        {/* 왼쪽: 문구 */}
        <div className="relative z-10 flex flex-col gap-2">
          <p className="font-label text-[10px] tracking-[0.4em] uppercase text-primary">
            Zero-Knowledge Architecture
          </p>
          <p className="font-headline text-xl font-light text-surface tracking-tight">
            서버는 당신이 무슨 말을 했는지 알 수 없습니다.
          </p>
        </div>

        {/* 오른쪽: 기술 태그 목록 */}
        <div className="relative z-10 flex flex-wrap items-center gap-3">
          {['E2E 암호화', 'BYOK', 'No Server Logs', 'ASAR 패킹', 'Local-only 저장'].map((tag) => (
            <span
              key={tag}
              className="font-label text-[10px] uppercase tracking-wider border border-white/20 text-white/60 px-3 py-1.5 hover:border-primary hover:text-primary transition-colors duration-200"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
