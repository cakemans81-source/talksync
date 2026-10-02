/**
 * RMS fallback VAD engine tests against the REAL production module.
 * Run: node src/lib/rmsVadEngine.test.mjs
 *
 * Compiles rmsVadEngine.ts via tsc (no tsx dep), then feeds contiguous PCM blocks
 * and asserts each sample is emitted exactly once with the right segmentation.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const outDir = mkdtempSync(join(tmpdir(), 'rms-vad-'));
let failed = 0;

function assert(name, cond) {
  if (!cond) {
    console.error('FAIL:', name);
    failed += 1;
  } else {
    console.log('PASS:', name);
  }
}

const SR = 16000;
const BLOCK = 1024;
const LOUD_AMP = 0.1;

/** Build a block whose samples carry a unique, increasing index so duplicates/gaps are detectable. */
function makeBlock(startIndex, loud) {
  const b = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    // loud: alternating ±LOUD_AMP with a tiny index tag; quiet: tiny index tag only
    const tag = ((startIndex + i) % 1000) * 1e-7;
    b[i] = loud ? (i % 2 === 0 ? LOUD_AMP : -LOUD_AMP) + tag : tag;
  }
  return b;
}

function run(engineFactory, pattern, opts, mutedAt = () => false) {
  const events = [];
  const engine = engineFactory(
    {
      sampleRate: SR,
      minRms: 0.005,
      rmsTimeoutMs: 900,
      minSpeechMs: 300,
      maxSpeechMs: 15000,
      streamMode: 'speech',
      streaming: false,
      chunkSamples: 1600,
      ...opts,
    },
    {
      onSpeechStart: () => events.push({ type: 'start' }),
      onSpeechEnd: (audio) => events.push({ type: 'end', audio: audio.slice() }),
      onSpeechFrame: (pcm) => events.push({ type: 'frame', pcm: pcm.slice() }),
    }
  );
  let idx = 0;
  const fed = [];
  pattern.forEach((loud, n) => {
    const block = makeBlock(idx, loud);
    fed.push(block.slice());
    engine.process(block, mutedAt(n));
    // Simulate ScriptProcessor buffer reuse: scribble over the block after processing
    block.fill(9);
    idx += BLOCK;
  });
  return { events, fed };
}

function concat(arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function equalArr(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const quiet = (n) => Array(n).fill(false);
const loud = (n) => Array(n).fill(true);

try {
  execFileSync(
    process.execPath,
    [
      require.resolve('typescript/bin/tsc'),
      join(__dirname, 'rmsVadEngine.ts'),
      '--outDir', outDir,
      '--module', 'commonjs',
      '--target', 'es2020',
      '--lib', 'es2020,dom',
      '--skipLibCheck',
    ],
    { stdio: 'pipe' }
  );

  const { createRmsVadEngine } = require(join(outDir, 'rmsVadEngine.js'));
  const silenceBlocks = Math.ceil((900 / 1000) * SR / BLOCK); // 15 blocks ≥ 900ms

  // 1) batch: one utterance → exactly the voiced samples, once, no overlap, trailing silence trimmed
  {
    const pattern = [...quiet(3), ...loud(10), ...quiet(2), ...loud(5), ...quiet(silenceBlocks + 2)];
    const { events, fed } = run(createRmsVadEngine, pattern, {});
    const starts = events.filter((e) => e.type === 'start').length;
    const ends = events.filter((e) => e.type === 'end');
    assert('batch: one start', starts === 1);
    assert('batch: one end', ends.length === 1);
    const expected = concat(fed.slice(3, 3 + 10 + 2 + 5)); // loud + mid-pause + loud, no tail
    assert('batch: audio == contiguous voiced samples (no duplication, tail trimmed)', ends[0] && equalArr(ends[0].audio, expected));
    assert('batch: no frames emitted', events.every((e) => e.type !== 'frame'));
  }

  // 2) batch: too short (< minSpeechMs) → dropped
  {
    const pattern = [...loud(2), ...quiet(silenceBlocks + 1)]; // 128ms
    const { events } = run(createRmsVadEngine, pattern, {});
    assert('batch: short burst dropped (no end)', events.filter((e) => e.type === 'end').length === 0);
  }

  // 3) rmsTimeoutMs option honoured (shorter timeout ends earlier)
  {
    const pattern = [...loud(10), ...quiet(6)];
    const { events } = run(createRmsVadEngine, pattern, { rmsTimeoutMs: 300 }); // 300ms ≈ 4.7 blocks
    assert('rmsTimeoutMs=300 ends within 6 quiet blocks', events.filter((e) => e.type === 'end').length === 1);
    const { events: ev2 } = run(createRmsVadEngine, pattern, { rmsTimeoutMs: 900 });
    assert('rmsTimeoutMs=900 not yet ended after 6 quiet blocks', ev2.filter((e) => e.type === 'end').length === 0);
  }

  // 4) maxSpeechMs forced EoT
  {
    const maxBlocks = Math.ceil((2000 / 1000) * SR / BLOCK); // 2s
    const { events, fed } = run(createRmsVadEngine, loud(maxBlocks + 3), { maxSpeechMs: 2000 });
    const ends = events.filter((e) => e.type === 'end');
    assert('maxSpeechMs: forced end fired', ends.length === 1);
    assert('maxSpeechMs: forced chunk = first maxBlocks blocks', ends[0] && equalArr(ends[0].audio, concat(fed.slice(0, maxBlocks))));
  }

  // 5) streaming speech mode: 100ms frames, every voiced sample sent once, empty end signal
  {
    const pattern = [...quiet(2), ...loud(20), ...quiet(silenceBlocks)];
    const { events, fed } = run(createRmsVadEngine, pattern, { streaming: true });
    const frames = events.filter((e) => e.type === 'frame');
    const ends = events.filter((e) => e.type === 'end');
    assert('stream/speech: frames are 1600 samples except last', frames.slice(0, -1).every((f) => f.pcm.length === 1600));
    const sent = concat(frames.map((f) => f.pcm));
    const expected = concat(fed.slice(2, 2 + 20 + silenceBlocks)); // streams through redemption tail like Silero
    assert('stream/speech: concatenated frames == contiguous input (no dup/gap)', equalArr(sent, expected));
    assert('stream/speech: single empty end', ends.length === 1 && ends[0].audio.length === 0);
    assert('stream/speech: end comes after last frame', events[events.length - 1].type === 'end');
  }

  // 6) streaming continuous mode (Browser Tab Rx): loud blocks stream, quiet block ends
  {
    const pattern = [...quiet(1), ...loud(5), ...quiet(1), ...loud(3), ...quiet(1)];
    const { events, fed } = run(createRmsVadEngine, pattern, { streaming: true, streamMode: 'continuous' });
    const starts = events.filter((e) => e.type === 'start').length;
    const ends = events.filter((e) => e.type === 'end');
    const sent = concat(events.filter((e) => e.type === 'frame').map((f) => f.pcm));
    const expected = concat([...fed.slice(1, 6), ...fed.slice(7, 10)]);
    assert('stream/continuous: two segments', starts === 2 && ends.length === 2);
    assert('stream/continuous: all loud samples sent exactly once, quiet dropped', equalArr(sent, expected));
    assert('stream/continuous: end signals are empty', ends.every((e) => e.audio.length === 0));
  }

  // 7) continuous without onSpeechFrame behaves like batch speech mode (same as Silero path)
  {
    const pattern = [...loud(10), ...quiet(silenceBlocks)];
    const { events } = run(createRmsVadEngine, pattern, { streaming: false, streamMode: 'continuous' });
    assert('continuous w/o streaming → batch end with audio', events.filter((e) => e.type === 'end' && e.audio.length > 0).length === 1);
  }

  // 8) mute gate drops in-progress speech without callbacks
  {
    const pattern = [...loud(10), ...loud(2), ...quiet(silenceBlocks)];
    const { events } = run(createRmsVadEngine, pattern, {}, (n) => n === 10 || n === 11);
    assert('muted: in-progress utterance discarded (no end)', events.filter((e) => e.type === 'end').length === 0);
  }
} catch (e) {
  console.error('FAIL: test harness error', e?.stdout?.toString?.() ?? '', e);
  failed += 1;
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll RMS VAD engine tests passed');
