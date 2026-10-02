import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { streamChunks } from '../lib/stream.mjs';

test('fast mode: chunk sizes, timestamps, last flag', async () => {
  const chunks = [];
  for await (const c of streamChunks(new Float32Array(4000), { chunkMs: 100, fast: true })) chunks.push(c);
  assert.deepEqual(chunks.map((c) => c.samples.length), [1600, 1600, 800]);
  assert.deepEqual(chunks.map((c) => c.audioTimeSec), [0, 0.1, 0.2]);
  assert.equal(chunks[2].endTimeSec, 0.25);
  assert.deepEqual(chunks.map((c) => c.last), [false, false, true]);
});

test('paced mode: delivery follows audio time at 1x', async () => {
  const t0 = performance.now();
  let lastWall = 0;
  for await (const c of streamChunks(new Float32Array(4800), { chunkMs: 100 })) lastWall = c.wallTimeMs - t0;
  assert.ok(lastWall >= 280, `last chunk at ${lastWall}ms`);
  assert.ok(lastWall < 600, `last chunk at ${lastWall}ms`);
});

test('empty audio yields nothing', async () => {
  const out = [];
  for await (const c of streamChunks(new Float32Array(0), { fast: true })) out.push(c);
  assert.equal(out.length, 0);
});
