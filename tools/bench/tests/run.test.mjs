import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateSampleData } from '../make-sample-data.mjs';
import { runBench } from '../run.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(BENCH, 'manifests', 'sample.jsonl');

function withTmp(fn) {
  return async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'bench-'));
    try {
      generateSampleData(path.join(tmp, 'data'));
      await fn(tmp, path.join(tmp, 'data'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

test('end-to-end dummy run (--fast): latency fields and summary shape', withTmp(async (tmp, dataDir) => {
  const { outDir, summary, segments } = await runBench({
    manifest: MANIFEST, dataDir, out: path.join(tmp, 'out'), tgt: 'ko', fast: true,
    asrOpts: { delayMs: 40 }, mtOpts: { firstTokenMs: 20, tokenMs: 5 },
  });
  assert.equal(segments.length, 3);
  for (const s of segments) {
    assert.equal(s.error, undefined);
    assert.ok(s.lAsrMs >= 38 && s.lAsrMs < 500, `L_asr ${s.lAsrMs}`);
    assert.ok(s.lFirstMs >= s.lAsrMs && s.lSubMs >= s.lFirstMs, 'L_asr <= L_first <= L_sub');
    assert.ok(s.lFirstMs - s.lAsrMs >= 18, 'MT first-token delay reflected');
    assert.equal(s.asrRate, 0);
  }
  const ko = segments.find((s) => s.lang === 'ko');
  assert.equal(ko.chrf, 100);
  assert.equal(ko.audioSec, 1.5);
  assert.equal(segments.find((s) => s.lang === 'ja').audioSec, 1);

  assert.deepEqual(Object.keys(summary.byLang), ['en', 'ja', 'ko']);
  for (const g of [summary.overall, ...Object.values(summary.byLang)]) {
    for (const k of ['asr', 'first', 'sub']) {
      assert.equal(typeof g.latency[k].p50, 'number');
      assert.equal(typeof g.latency[k].p95, 'number');
    }
    assert.equal(g.pass.p95, true);
    assert.equal(g.pass.block, true);
    assert.equal(typeof g.sys.rssPeakMB, 'number');
  }
  assert.equal(summary.overall.n, 3);
  assert.equal(summary.byLang.en.wer.rate, 0);
  assert.equal(summary.byLang.ko.cer.rate, 0);
  assert.equal(summary.byLang.ko.chrf, 100);
  assert.equal(summary.run.tgt, 'ko');

  for (const f of ['segments.jsonl', 'summary.json', 'summary.md']) assert.ok(existsSync(path.join(outDir, f)), f);
  assert.equal(readFileSync(path.join(outDir, 'segments.jsonl'), 'utf8').trim().split('\n').length, 3);
  assert.equal(JSON.parse(readFileSync(path.join(outDir, 'summary.json'), 'utf8')).overall.n, 3);
  assert.match(readFileSync(path.join(outDir, 'summary.md'), 'utf8'), /\| ALL \| 3 \|/);
}));

test('threshold failure is reported (slow dummy MT)', withTmp(async (tmp, dataDir) => {
  const { summary } = await runBench({
    manifest: MANIFEST, dataDir, out: path.join(tmp, 'out'), tgt: 'ko', fast: true,
    asrOpts: { delayMs: 10 }, mtOpts: { firstTokenMs: 2100, tokenMs: 0 },
  });
  assert.equal(summary.overall.pass.p95, false);
  assert.equal(summary.overall.pass.block, true);
}));

test('missing audio gives a helpful error', async () => {
  await assert.rejects(
    runBench({ manifest: MANIFEST, dataDir: path.join(tmpdir(), 'bench-nonexistent'), tgt: 'ko', fast: true }),
    /audio not found/,
  );
});

test('CLI smoke: --fast prints summary table', withTmp((tmp, dataDir) => {
  const r = spawnSync(
    process.execPath,
    [path.join(BENCH, 'run.mjs'), '--manifest', MANIFEST, '--asr', 'dummy', '--mt', 'dummy', '--tgt', 'ko', '--fast',
      '--data-dir', dataDir, '--out', path.join(tmp, 'out'), '--asr-opt', 'delayMs=10', '--mt-opt', 'firstTokenMs=5'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| ALL \| 3 \|/);
  assert.ok(existsSync(path.join(tmp, 'out', 'summary.md')));
}));
