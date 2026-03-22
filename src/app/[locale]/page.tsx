import { notFound } from 'next/navigation';
import { getDictionary, hasLocale, type Locale } from './dictionaries';
import { LanguageSwitcher } from '@/components/landing/LanguageSwitcher';
import { LocalizedTrustSection } from '@/components/landing/TrustSection';

const DOWNLOAD_URL =
  'https://github.com/cakemans81-source/talksync/releases/latest/download/TalkSync-Setup.exe';

export default async function LocalePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(locale)) notFound();

  const d = getDictionary(locale);
  const loc = locale as Locale;

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
            <LanguageSwitcher current={loc} />
            <a href={DOWNLOAD_URL} className="bg-primary text-on-primary px-6 py-2 text-sm font-medium hover:opacity-90 active:scale-[0.99] transition-all">
              {d.nav.download}
            </a>
          </div>
        </div>
      </nav>

      <main>

        {/* Hero */}
        <section className="relative pt-32 pb-20 px-8 max-w-[1440px] mx-auto overflow-hidden">
          <div className="flex flex-col items-center text-center mb-20">
            <h1 className="font-headline text-[4rem] md:text-[6.5rem] leading-[1.1] font-extralight text-on-background text-kern-tight mb-4">
              {d.hero.headline}
            </h1>
            <p className="font-label text-sm uppercase tracking-[0.3em] text-outline mb-12">
              {d.hero.subtitle}
            </p>
            <a
              href={DOWNLOAD_URL}
              className="bg-on-background text-surface px-12 py-4 rounded-full font-medium hover:opacity-90 transition-all text-sm tracking-wider flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
              {d.hero.cta}
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
              {[4, 12, 8, 16, 6, 20, 10, 4].map((h, i) => (
                <div key={i} className="w-[1px] bg-primary" style={{ height: `${h * 4}px` }} />
              ))}
            </div>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="py-24 px-8 max-w-[1440px] mx-auto grid grid-cols-1 md:grid-cols-4 gap-0 border-t border-[#E5E5E5]">
          {d.features.map((card, i) => (
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
            <h2 className="font-headline text-4xl font-extralight tracking-tight">{d.process.label}</h2>
            <div className="w-1/3 h-[1px] bg-outline-variant opacity-30 mb-2" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-20">
            {d.process.steps.map((step) => (
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
            <p className="font-label text-xs tracking-widest text-primary mb-4 uppercase">{d.free.eyebrow}</p>
            <h2 className="font-headline text-[3rem] font-extralight tracking-tight mb-6">{d.free.headline}</h2>
            <p className="font-body text-sm text-outline leading-relaxed max-w-xl mx-auto whitespace-pre-line">
              {d.free.desc}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-[#E5E5E5] mb-20">
            {d.free.items.map((item, i) => (
              <div key={i} className="p-10 border-r border-[#E5E5E5] last:border-r-0 flex flex-col gap-4">
                <span className="material-symbols-outlined text-primary text-3xl">{item.icon}</span>
                <h3 className="font-headline text-lg font-normal">{item.title}</h3>
                <p className="font-body text-sm text-outline leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="w-full h-24 border-2 border-dashed border-[#E5E5E5] flex items-center justify-center bg-[#fafafa]">
            <p className="font-label text-[10px] uppercase tracking-widest text-outline">Advertisement · 728 × 90</p>
          </div>
        </section>

        {/* Trust & Security */}
        <LocalizedTrustSection dict={d.trust} />

        {/* Interstitial */}
        <section className="py-40 flex flex-col items-center justify-center bg-zinc-950 text-surface overflow-hidden relative">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-primary blur-[120px] rounded-full" />
          </div>
          <h2 className="font-headline text-[3.5rem] md:text-[5rem] font-extralight leading-none text-center mb-8 relative z-10 whitespace-pre-line">
            {d.interstitial.headline}
          </h2>
          <div className="h-10 w-[1px] bg-primary mb-8 relative z-10" />
          <p className="font-label text-[10px] tracking-[0.4em] uppercase text-outline relative z-10">{d.interstitial.sub}</p>
        </section>

      </main>

      {/* Footer */}
      <footer className="w-full py-12 px-8 border-t border-[#E5E5E5] bg-[#f9f9f9]">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8 w-full max-w-[1440px] mx-auto">
          <div>
            <span className="text-lg font-bold text-[#111111] font-headline">TalkSync</span>
            <p className="font-headline font-light tracking-[0.1rem] text-[10px] uppercase text-zinc-400 mt-2">
              {d.footer.tagline}
            </p>
          </div>
          <div className="flex gap-8 items-center">
            <LanguageSwitcher current={loc} />
            {d.footer.links.map((link) => (
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
