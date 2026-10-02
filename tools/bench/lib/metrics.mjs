/** ASR/MT 품질 지표 + 지연 통계 (무의존성). */

const CJK = new Set(['ja', 'zh', 'ko']);
export const isCjk = (lang) => CJK.has(String(lang).toLowerCase().split(/[-_]/)[0]);

/** NFKC → 소문자 → 아포스트로피 제거 → 기타 문장부호/기호는 공백 → 공백 정리 */
export function normalizeText(s) {
  return String(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein 거리 (배열 입력, 2-row DP) */
export function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const rateOf = (errors, refLen) => (refLen > 0 ? errors / refLen : errors > 0 ? 1 : 0);

/** 공백 토큰 기준 WER → {errors, refLen, rate} (코퍼스 집계는 errors/refLen 합산) */
export function wer(ref, hyp) {
  const r = normalizeText(ref).split(' ').filter(Boolean);
  const h = normalizeText(hyp).split(' ').filter(Boolean);
  const errors = editDistance(r, h);
  return { errors, refLen: r.length, rate: rateOf(errors, r.length) };
}

/** 공백·문장부호 제거 후 문자(코드포인트) 단위 CER */
export function cer(ref, hyp) {
  const strip = (s) => Array.from(normalizeText(s).replace(/\s+/g, ''));
  const r = strip(ref);
  const h = strip(hyp);
  const errors = editDistance(r, h);
  return { errors, refLen: r.length, rate: rateOf(errors, r.length) };
}

/** ja/zh/ko → CER, 그 외 → WER */
export function asrError(lang, ref, hyp) {
  return isCjk(lang) ? { metric: 'cer', ...cer(ref, hyp) } : { metric: 'wer', ...wer(ref, hyp) };
}

function charNgrams(chars, n) {
  const m = new Map();
  for (let i = 0; i + n <= chars.length; i++) {
    const k = chars.slice(i, i + n).join('');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** chrF n-gram 통계 (공백 제거, 코드포인트 단위). order별 {hyp, ref, match} */
export function chrfStats(hyp, ref, order = 6) {
  const h = Array.from(String(hyp).replace(/\s+/g, ''));
  const r = Array.from(String(ref).replace(/\s+/g, ''));
  const stats = [];
  for (let n = 1; n <= order; n++) {
    const hm = charNgrams(h, n);
    const rm = charNgrams(r, n);
    let match = 0;
    let hTot = 0;
    let rTot = 0;
    for (const [k, c] of hm) {
      hTot += c;
      match += Math.min(c, rm.get(k) ?? 0);
    }
    for (const c of rm.values()) rTot += c;
    stats.push({ hyp: hTot, ref: rTot, match });
  }
  return stats;
}

export function sumChrfStats(list) {
  return list.reduce(
    (acc, s) => acc.map((x, i) => ({ hyp: x.hyp + s[i].hyp, ref: x.ref + s[i].ref, match: x.match + s[i].match })),
    list[0].map(() => ({ hyp: 0, ref: 0, match: 0 })),
  );
}

/**
 * chrF-β (0-100). Popović 정의: n=1..6 문자 n-gram 정밀도/재현율을 (hyp,ref 둘 다 n-gram이
 * 존재하는 order에 대해) 산술평균한 뒤 F-β. 기본 β=2 (chrF2). sacreBLEU의 order별 F 평균과 다를 수 있음.
 */
export function chrfFromStats(stats, beta = 2) {
  let sp = 0;
  let sr = 0;
  let eff = 0;
  for (const s of stats) {
    if (s.hyp > 0 && s.ref > 0) {
      sp += s.match / s.hyp;
      sr += s.match / s.ref;
      eff++;
    }
  }
  if (eff === 0) return stats.every((s) => s.hyp === 0 && s.ref === 0) ? 100 : 0;
  const p = sp / eff;
  const r = sr / eff;
  if (p + r === 0) return 0;
  const b2 = beta * beta;
  return (100 * (1 + b2) * p * r) / (b2 * p + r);
}

export function chrf(hyp, ref, { order = 6, beta = 2 } = {}) {
  return chrfFromStats(chrfStats(hyp, ref, order), beta);
}

/** nearest-rank 백분위: sorted[ceil(p/100*n)-1]. 빈 입력은 null. (n이 작으면 P95 = max) */
export function percentile(values, p) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.max(1, Math.ceil((p / 100) * v.length)) - 1];
}

export function latencySummary(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return { n: 0, mean: null, p50: null, p95: null, max: null };
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    p50: percentile(v, 50),
    p95: percentile(v, 95),
    max: Math.max(...v),
  };
}
