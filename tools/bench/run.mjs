/**
 * TalkSync M1 벤치 러너.
 *   node tools/bench/run.mjs --manifest manifests/sample.jsonl --asr dummy --mt dummy --tgt ko [--fast]
 * 옵션: --chunk-ms 100, --out <dir>, --data-dir <dir>, --asr-opt k=v, --mt-opt k=v, --final-timeout-ms 10000
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadManifest } from './lib/manifest.mjs';
import { loadAudio16k, TARGET_RATE } from './lib/wav.mjs';
import { streamChunks } from './lib/stream.mjs';
import { asrError, chrfStats, chrfFromStats } from './lib/metrics.mjs';
import { SysMon } from './lib/sysmon.mjs';
import { buildSummary, renderMarkdown } from './lib/report.mjs';

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 절대경로 그대로, 상대경로는 cwd 기준(존재하거나 bench 하위일 때) 아니면 bench 디렉터리 기준 */
export function resolveBenchPath(p) {
  if (path.isAbsolute(p)) return p;
  const cwdPath = path.resolve(process.cwd(), p);
  const rel = path.relative(BENCH_DIR, cwdPath);
  const inBench = !rel.startsWith('..') && !path.isAbsolute(rel);
  return existsSync(cwdPath) || inBench ? cwdPath : path.resolve(BENCH_DIR, p);
}

export async function loadAdapter(kind, spec) {
  const isPath = /[\\/]/.test(spec) || spec.endsWith('.mjs');
  const file = isPath ? path.resolve(process.cwd(), spec) : path.join(BENCH_DIR, 'adapters', `${kind}-${spec}.mjs`);
  const mod = await import(pathToFileURL(file).href);
  return mod.default;
}

function parseKv(list = []) {
  const out = {};
  for (const item of list) {
    const i = item.indexOf('=');
    if (i < 1) throw new Error(`invalid --*-opt "${item}" (expected key=value)`);
    const v = item.slice(i + 1);
    out[item.slice(0, i)] = v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return out;
}

/** p가 timeoutMs 안에 끝나면 false, 타임아웃이면 true */
async function timedOut(p, timeoutMs) {
  let timer;
  const t = new Promise((r) => {
    timer = setTimeout(() => r(true), timeoutMs);
  });
  const res = await Promise.race([p.then(() => false), t]);
  clearTimeout(timer);
  return res;
}

async function runSegment(seg, ctx) {
  const { asr, mt, tgt, chunkMs, fast, mon, dataDir, finalTimeoutMs, history } = ctx;
  const audio = loadAudio16k(path.join(dataDir, seg.audio), seg.startSec, seg.endSec);
  const stream = asr.createStream({ refText: seg.refText });
  const finals = [];
  let onFinal;
  const gotFinal = new Promise((r) => (onFinal = r));
  stream.onEvent((e) => {
    if (e.type === 'final') {
      finals.push(e);
      onFinal();
    }
  });

  const win = mon.startWindow();
  let anchor = performance.now();
  for await (const c of streamChunks(audio, { sampleRate: TARGET_RATE, chunkMs, fast })) {
    anchor = c.wallTimeMs;
    stream.acceptAudio(c.samples, c.audioTimeSec);
  }
  await timedOut(Promise.resolve(stream.flush()), finalTimeoutMs);
  if (finals.length === 0) await timedOut(gotFinal, finalTimeoutMs);

  const asrText = finals.map((f) => f.text).join(' ').trim();
  const err = asrError(seg.lang, seg.refText, asrText);
  const rec = {
    id: seg.id, set: seg.set, lang: seg.lang, tgt, audioSec: audio.length / TARGET_RATE,
    refText: seg.refText, asrText, finalCount: finals.length,
    asrMetric: err.metric, asrErrors: err.errors, asrRefLen: err.refLen, asrRate: err.rate,
    mtText: null, refTranslation: seg.refTranslations[tgt] ?? null, chrf: null, chrfStats: null,
    lAsrMs: finals.length ? Math.max(0, finals.at(-1).wallTimeMs - anchor) : null,
    lFirstMs: null, lSubMs: null,
  };

  if (asrText) {
    const hist = history.get(seg.set) ?? [];
    let first = null;
    let mtText = '';
    for await (const t of mt.translate(asrText, { src: seg.lang, tgt, context: hist.slice(-2) })) {
      if (first === null) first = t.wallTimeMs;
      mtText += t.token;
    }
    const end = performance.now();
    rec.mtText = mtText;
    rec.lFirstMs = Math.max(0, (first ?? end) - anchor);
    rec.lSubMs = Math.max(0, end - anchor);
    history.set(seg.set, [...hist, asrText].slice(-2));
    if (rec.refTranslation !== null) {
      rec.chrfStats = chrfStats(mtText, rec.refTranslation);
      rec.chrf = chrfFromStats(rec.chrfStats);
    }
  }
  const sys = mon.endWindow(win);
  rec.cpuPeakPct = sys.cpuPeakPct;
  rec.rssPeakMB = sys.rssPeakMB;
  return rec;
}

/**
 * @param {object} o manifest, tgt 필수. asr/mt(기본 'dummy'), fast, chunkMs, out, dataDir, asrOpts, mtOpts, finalTimeoutMs, log
 * @returns {Promise<{outDir:string, summary:object, segments:object[]}>}
 */
export async function runBench(o) {
  const { asr: asrSpec = 'dummy', mt: mtSpec = 'dummy', tgt, fast = false, chunkMs = 100, finalTimeoutMs = 10000, log = () => {} } = o;
  if (!o.manifest) throw new Error('--manifest is required');
  if (!tgt) throw new Error('--tgt is required');
  const manifestPath = resolveBenchPath(o.manifest);
  const dataDir = o.dataDir ? resolveBenchPath(o.dataDir) : path.join(BENCH_DIR, 'data');
  const entries = loadManifest(manifestPath);
  for (const e of entries) {
    const f = path.join(dataDir, e.audio);
    if (!existsSync(f)) throw new Error(`audio not found: ${f} (id=${e.id}). 샘플은 node tools/bench/make-sample-data.mjs 로 생성`);
  }

  const startedAt = new Date();
  const id = startedAt.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const outDir = o.out ? resolveBenchPath(o.out) : path.join(BENCH_DIR, 'results', id);
  mkdirSync(outDir, { recursive: true });

  const asr = await loadAdapter('asr', asrSpec);
  const mt = await loadAdapter('mt', mtSpec);
  await asr.init(o.asrOpts ?? {});
  await mt.init(o.mtOpts ?? {});

  const mon = new SysMon().start();
  const ctx = { asr, mt, tgt, chunkMs, fast, mon, dataDir, finalTimeoutMs, history: new Map() };
  const segments = [];
  for (const seg of entries) {
    try {
      segments.push(await runSegment(seg, ctx));
    } catch (err) {
      segments.push({ id: seg.id, set: seg.set, lang: seg.lang, tgt, error: String(err?.stack ?? err) });
    }
    const r = segments.at(-1);
    log(`${r.id}: ${r.error ? 'ERROR' : `L_asr=${r.lAsrMs?.toFixed(0)}ms L_sub=${r.lSubMs?.toFixed(0)}ms`}`);
  }
  mon.stop();

  const run = {
    id, startedAt: startedAt.toISOString(), manifest: path.basename(manifestPath), asr: asr.name ?? asrSpec, mt: mt.name ?? mtSpec,
    tgt, fast, chunkMs, node: process.version, platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length,
  };
  const summary = buildSummary(segments, run);
  writeFileSync(path.join(outDir, 'segments.jsonl'), segments.map((s) => JSON.stringify(s)).join('\n') + '\n');
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  writeFileSync(path.join(outDir, 'summary.md'), renderMarkdown(summary));
  return { outDir, summary, segments };
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      manifest: { type: 'string' }, asr: { type: 'string', default: 'dummy' }, mt: { type: 'string', default: 'dummy' },
      tgt: { type: 'string' }, fast: { type: 'boolean', default: false }, 'chunk-ms': { type: 'string', default: '100' },
      out: { type: 'string' }, 'data-dir': { type: 'string' }, 'asr-opt': { type: 'string', multiple: true },
      'mt-opt': { type: 'string', multiple: true }, 'final-timeout-ms': { type: 'string', default: '10000' },
    },
  });
  const { outDir, summary } = await runBench({
    manifest: v.manifest, asr: v.asr, mt: v.mt, tgt: v.tgt, fast: v.fast, chunkMs: Number(v['chunk-ms']),
    out: v.out, dataDir: v['data-dir'], asrOpts: parseKv(v['asr-opt']), mtOpts: parseKv(v['mt-opt']),
    finalTimeoutMs: Number(v['final-timeout-ms']), log: (m) => console.log(m),
  });
  console.log(`\nresults: ${outDir}\n`);
  console.log(renderMarkdown(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
