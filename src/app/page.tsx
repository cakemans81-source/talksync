// GitHub Releases 다운로드 URL — 릴리스 업로드 후 이 URL로 자동 연결됨
const DOWNLOAD_URL =
  "https://github.com/cakemans81-source/talksync/releases/latest/download/TalkSync-Setup.exe";

export default function Home() {
  return (
    <div className="bg-surface text-on-background font-body selection:bg-primary-container selection:text-on-primary-container">

      {/* Nav */}
      <nav className="sticky w-full top-0 z-50 bg-white border-b border-[#E5E5E5]">
        <div className="flex justify-between items-center w-full px-8 py-6 max-w-[1440px] mx-auto">
          <div className="text-2xl font-extralight tracking-tighter text-[#111111] uppercase font-headline">
            TalkSync
          </div>
          <div className="hidden md:flex items-center gap-12 font-headline font-extralight tracking-tight text-sm">
            <a className="text-[#111111] font-medium border-b border-[#111111] pb-1" href="#">Translation</a>
            <a className="text-zinc-500 hover:text-[#111111] transition-colors" href="#">Curation</a>
            <a className="text-zinc-500 hover:text-[#111111] transition-colors" href="#">Editorial</a>
          </div>
          <div className="flex items-center gap-6">
            <a href={DOWNLOAD_URL} className="font-headline font-extralight tracking-tight text-sm text-zinc-500 hover:opacity-70 transition-opacity">다운로드</a>
            <a href={DOWNLOAD_URL} className="bg-primary text-on-primary px-6 py-2 text-sm font-medium hover:opacity-90 active:scale-[0.99] transition-all">Windows 다운로드</a>
          </div>
        </div>
      </nav>

      <main>

        {/* Hero */}
        <section className="relative pt-32 pb-20 px-8 max-w-[1440px] mx-auto overflow-hidden">
          <div className="flex flex-col items-center text-center mb-20">
            <h1 className="font-headline text-[4rem] md:text-[6.5rem] leading-[1.1] font-extralight text-on-background text-kern-tight mb-4">
              언어의 경계 없이, 대화하다
            </h1>
            <p className="font-label text-sm uppercase tracking-[0.3em] text-outline mb-12">
              Real-time AI Voice Translation
            </p>
            <a
              href={DOWNLOAD_URL}
              className="bg-on-background text-surface px-12 py-4 rounded-full font-medium hover:opacity-90 transition-all text-sm tracking-wider flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              Windows용 다운로드 (무료)
            </a>
          </div>
          <div className="relative w-full aspect-[21/9] bg-surface-container-low overflow-hidden group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Two high-fashion figures in silhouette facing each other"
              className="w-full h-full object-cover grayscale contrast-125 opacity-90 group-hover:scale-105 transition-transform duration-1000"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBA6SWA9pkAZlfPT2HfgH8dui9JbUTdjAFhqw0pugFvWPHs8vXW0lb1vJbD7XXWaZEwNW15gwx2XzIXTdWULyiK9ZixZC4CVfJfDmiWIE5O5ViYNYykNlOI7_msfejEgy1SX7wxXSNrgFpLFIgVhcmPq-HzbGeS_Ki44EOuNRdUs7tR9RnmaN_U__jbvunUCch9aCt9xxlyNRtNVPl6GwT1eb8mT-UP37rkAUegdu1eNuWNNHZZ2TSQjCULeoB3tE46tds_GZuXAeM"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-40" />
            <div className="absolute bottom-8 left-8 flex items-end gap-1">
              <div className="w-[1px] h-4 bg-primary" />
              <div className="w-[1px] h-12 bg-primary" />
              <div className="w-[1px] h-8 bg-primary" />
              <div className="w-[1px] h-16 bg-primary" />
              <div className="w-[1px] h-6 bg-primary" />
              <div className="w-[1px] h-20 bg-primary" />
              <div className="w-[1px] h-10 bg-primary" />
              <div className="w-[1px] h-4 bg-primary" />
            </div>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="py-24 px-8 max-w-[1440px] mx-auto grid grid-cols-1 md:grid-cols-4 gap-0 border-t border-[#E5E5E5]">
          {[
            { icon: "translate", title: "실시간 번역", desc: "말하는 순간, 상대방 언어로 전달되어 끊김 없는 대화가 가능합니다." },
            { icon: "public", title: "40+ 언어", desc: "전 세계 주요 언어를 하나의 앱으로 지원하여 글로벌 소통을 돕습니다." },
            { icon: "settings_voice", title: "AI 음성 합성", desc: "사용자의 목소리 톤과 억양을 유지한 채 번역된 음성을 생성합니다." },
            { icon: "verified_user", title: "보안", desc: "엔드투엔드 암호화 기술로 모든 대화 내용을 안전하게 보호합니다." },
          ].map((card, i) => (
            <div key={i} className="p-10 border-r border-[#E5E5E5] last:border-r-0 hover:bg-white transition-colors">
              <span className="material-symbols-outlined text-primary mb-8 block">{card.icon}</span>
              <h3 className="font-headline text-lg font-normal mb-4">{card.title}</h3>
              <p className="font-body text-sm text-outline leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </section>

        {/* How It Works */}
        <section className="py-32 px-8 max-w-[1440px] mx-auto bg-surface-container-lowest">
          <div className="mb-24 flex justify-between items-end">
            <h2 className="font-headline text-4xl font-extralight tracking-tight">PROCESS</h2>
            <div className="w-1/3 h-[1px] bg-outline-variant opacity-30 mb-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-20">
            {[
              { num: "01", icon: "mic_none", title: "음성 입력", desc: "자신의 언어로 자연스럽게 말하세요. AI가 실시간으로 소리를 캡처합니다." },
              { num: "02", icon: "auto_awesome", title: "AI 분석 및 번역", desc: "고도화된 엔진이 맥락을 파악하고 최적의 번역을 수행합니다." },
              { num: "03", icon: "volume_up", title: "즉각적인 출력", desc: "번역된 문장이 상대방의 언어로 생생하게 흘러나옵니다." },
            ].map((step) => (
              <div key={step.num} className="flex flex-col gap-6">
                <span className="font-headline text-6xl text-outline-variant opacity-20 font-extralight">{step.num}</span>
                <span className="material-symbols-outlined text-3xl">{step.icon}</span>
                <h4 className="font-headline text-xl font-light">{step.title}</h4>
                <p className="text-sm text-outline leading-relaxed max-w-xs">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Free Promise */}
        <section className="py-32 px-8 max-w-[1440px] mx-auto">
          <div className="text-center mb-20">
            <p className="font-label text-xs tracking-widest text-primary mb-4 uppercase">100% Free, Always</p>
            <h2 className="font-headline text-[3rem] font-extralight tracking-tight mb-6">TalkSync는 완전 무료입니다</h2>
            <p className="font-body text-sm text-outline leading-relaxed max-w-xl mx-auto">
              계정 생성부터 실시간 통역까지, 어떠한 결제도 필요하지 않습니다.<br />
              광고를 통해 서비스를 운영하므로 모든 기능을 무료로 제공할 수 있습니다.
            </p>
          </div>

          {/* Free features grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#E5E5E5] mb-20">
            {[
              { icon: "all_inclusive", title: "무제한 사용", desc: "시간 제한 없이 언제든 실시간 통역을 이용하세요." },
              { icon: "credit_card_off", title: "카드 등록 불필요", desc: "신용카드나 결제 정보 없이 이메일만으로 시작할 수 있습니다." },
              { icon: "lock_open", title: "모든 기능 제공", desc: "프리미엄 기능 구분 없이 모든 언어와 기능을 동등하게 사용합니다." },
            ].map((item, i) => (
              <div key={i} className="p-10 border-r border-[#E5E5E5] last:border-r-0 flex flex-col gap-4">
                <span className="material-symbols-outlined text-primary text-3xl">{item.icon}</span>
                <h3 className="font-headline text-lg font-normal">{item.title}</h3>
                <p className="font-body text-sm text-outline leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          {/* Ad banner placeholder */}
          <div className="w-full h-24 border-2 border-dashed border-[#E5E5E5] flex items-center justify-center bg-[#fafafa]">
            <p className="font-label text-[10px] uppercase tracking-widest text-outline">Advertisement · 728 × 90</p>
          </div>
        </section>

        {/* Interstitial */}
        <section className="py-40 flex flex-col items-center justify-center bg-zinc-950 text-surface overflow-hidden relative">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary blur-[120px] rounded-full" />
          </div>
          <h2 className="font-headline text-[3.5rem] md:text-[5rem] font-extralight leading-none text-center mb-8 relative z-10">
            GLOBAL DISCOURSE<br />ARCHIVED.
          </h2>
          <div className="h-10 w-[1px] bg-primary mb-8 relative z-10" />
          <p className="font-label text-[10px] tracking-[0.4em] uppercase text-outline relative z-10">Beyond the Language Barrier</p>
        </section>

      </main>

      {/* Footer */}
      <footer className="w-full py-12 px-8 border-t border-[#E5E5E5] bg-[#f9f9f9]">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8 w-full max-w-[1440px] mx-auto">
          <div>
            <span className="text-lg font-bold text-[#111111] font-headline">TalkSync</span>
            <p className="font-headline font-light tracking-[0.1rem] text-[10px] uppercase text-zinc-400 mt-2">© 2024 TALKSYNC. ARCHIVING GLOBAL DISCOURSE.</p>
          </div>
          <div className="flex gap-8">
            {["Privacy Policy", "Terms of Service", "Instagram", "LinkedIn"].map((link) => (
              <a key={link} className="font-headline font-light tracking-[0.1rem] text-[10px] uppercase text-zinc-400 hover:text-[#5d3fe0] transition-colors duration-300" href="#">
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>

    </div>
  );
}
