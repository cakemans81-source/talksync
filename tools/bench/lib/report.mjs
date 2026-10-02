/** 세그먼트 결과 → summary.json 구조 + summary.md 렌더링. */
import { latencySummary, sumChrfStats, chrfFromStats } from './metrics.mjs';

export const THRESHOLDS = { p95SubMs: 2000, blockMs: 3500 };

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const max = (a) => (a.length ? Math.max(...a) : null);

function asrAgg(segs, metric) {
  const s = segs.filter((x) => x.asrMetric === metric);
  if (!s.length) return null;
  const errors = sum(s, (x) => x.asrErrors);
  const refLen = sum(s, (x) => x.asrRefLen);
  return { n: s.length, errors, refLen, rate: refLen > 0 ? errors / refLen : errors > 0 ? 1 : 0 };
}

export function summarizeGroup(all) {
  const segs = all.filter((s) => !s.error);
  const chrfStatsList = segs.filter((s) => s.chrfStats).map((s) => s.chrfStats);
  const lSub = segs.map((s) => s.lSubMs).filter((v) => v !== null);
  const sub = latencySummary(lSub);
  const overBlock = lSub.filter((v) => v > THRESHOLDS.blockMs).length;
  return {
    n: all.length,
    errors: all.length - segs.length,
    noFinal: segs.filter((s) => s.lAsrMs === null).length,
    wer: asrAgg(segs, 'wer'),
    cer: asrAgg(segs, 'cer'),
    chrf: chrfStatsList.length ? chrfFromStats(sumChrfStats(chrfStatsList)) : null,
    chrfN: chrfStatsList.length,
    latency: {
      asr: latencySummary(segs.map((s) => s.lAsrMs)),
      first: latencySummary(segs.map((s) => s.lFirstMs)),
      sub,
    },
    sys: {
      cpuPeakPct: max(segs.map((s) => s.cpuPeakPct).filter((v) => v !== null)),
      rssPeakMB: max(segs.map((s) => s.rssPeakMB).filter((v) => v !== null)),
    },
    overBlock,
    pass: {
      p95: sub.n ? sub.p95 <= THRESHOLDS.p95SubMs : null,
      block: sub.n ? overBlock === 0 : null,
    },
  };
}

export function buildSummary(segments, run) {
  const langs = [...new Set(segments.map((s) => s.lang))].sort();
  return {
    run,
    thresholds: THRESHOLDS,
    overall: summarizeGroup(segments),
    byLang: Object.fromEntries(langs.map((l) => [l, summarizeGroup(segments.filter((s) => s.lang === l))])),
  };
}

const pct = (x) => (x ? `${(x.rate * 100).toFixed(1)}%` : '-');
const ms = (v) => (v === null || v === undefined ? '-' : String(Math.round(v)));
const pair = (l) => `${ms(l.p50)} / ${ms(l.p95)}`;
const mark = (v) => (v === null ? '-' : v ? 'PASS' : 'FAIL');
const num = (v, d = 1) => (v === null || v === undefined ? '-' : v.toFixed(d));

export function renderMarkdown(summary) {
  const { run, thresholds: t } = summary;
  const rows = [...Object.entries(summary.byLang), ['ALL', summary.overall]];
  const lines = [
    `# Bench summary ${run.id}`,
    '',
    `- asr: \`${run.asr}\` / mt: \`${run.mt}\` / tgt: \`${run.tgt}\``,
    `- manifest: \`${run.manifest}\` (${summary.overall.n} segments), mode: ${run.fast ? 'fast (no pacing)' : '1x realtime'}, chunk: ${run.chunkMs} ms`,
    `- env: node ${run.node}, ${run.platform}, ${run.cpus} cpus`,
    `- 기준: L_sub P95 <= ${t.p95SubMs} ms (P95), 모든 세그먼트 L_sub <= ${t.blockMs} ms (block)`,
    '- 지연 단위 ms, P50 / P95 (nearest-rank). CPU%는 코어 1개=100%, in-process 샘플.',
    '',
    '| lang | n | WER | CER | chrF | L_asr P50/P95 | L_first P50/P95 | L_sub P50/P95 | CPU peak % | RSS peak MB | P95<=2s | all<=3.5s |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const [lang, g] of rows) {
    lines.push(
      `| ${lang} | ${g.n}${g.errors ? ` (${g.errors} err)` : ''} | ${pct(g.wer)} | ${pct(g.cer)} | ${num(g.chrf)} | ` +
        `${pair(g.latency.asr)} | ${pair(g.latency.first)} | ${pair(g.latency.sub)} | ` +
        `${num(g.sys.cpuPeakPct, 0)} | ${num(g.sys.rssPeakMB, 0)} | ${mark(g.pass.p95)} | ${mark(g.pass.block)} (${g.overBlock} over) |`,
    );
  }
  if (summary.overall.noFinal) lines.push('', `주의: final 없음 ${summary.overall.noFinal}건 (지연 통계 제외, WER/CER은 전체 삭제로 계산)`);
  return lines.join('\n') + '\n';
}
