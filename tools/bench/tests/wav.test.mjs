import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, parseWav, downmixToMono, resampleLinear, sliceSamples, toMono16k, TARGET_RATE } from '../lib/wav.mjs';

const ramp = (n) => Float32Array.from({ length: n }, (_, i) => (i / n) * 0.8 - 0.4);

test('PCM16 round trip (mono)', () => {
  const x = ramp(100);
  const w = parseWav(encodeWav([x], 16000));
  assert.deepEqual([w.sampleRate, w.channels, w.bitsPerSample, w.format, w.frames], [16000, 1, 16, 'pcm', 100]);
  for (let i = 0; i < 100; i++) assert.ok(Math.abs(w.channelData[0][i] - x[i]) < 1e-3);
});

test('float32 stereo round trip', () => {
  const w = parseWav(encodeWav([ramp(50), ramp(50).map((v) => -v)], 22050, 'float32'));
  assert.deepEqual([w.channels, w.format, w.bitsPerSample], [2, 'float', 32]);
  assert.ok(Math.abs(w.channelData[1][10] + w.channelData[0][10]) < 1e-6);
});

test('downmix averages channels', () => {
  const m = downmixToMono([Float32Array.of(1, 0.5), Float32Array.of(-1, 0.5)]);
  assert.deepEqual(Array.from(m), [0, 0.5]);
});

test('resampleLinear: length and linear ramp preserved', () => {
  const x = Float32Array.from({ length: 480 }, (_, i) => i / 480);
  const y = resampleLinear(x, 48000, 16000);
  assert.equal(y.length, 160);
  assert.ok(Math.abs(y[50] - x[150]) < 1e-5);
  assert.equal(resampleLinear(x, 16000, 16000), x);
  assert.equal(resampleLinear(ramp(160), 8000, 16000).length, 320);
});

test('toMono16k from 44.1 kHz stereo', () => {
  const n = 44100;
  const w = parseWav(encodeWav([new Float32Array(n).fill(0.2), new Float32Array(n).fill(0.4)], 44100));
  const y = toMono16k(w);
  assert.equal(y.length, TARGET_RATE);
  assert.ok(Math.abs(y[100] - 0.3) < 1e-3);
});

test('sliceSamples: bounds, null, clamp', () => {
  const x = Float32Array.from({ length: 32000 }, (_, i) => i);
  assert.equal(sliceSamples(x, 16000, 0.5, 1.5).length, 16000);
  assert.equal(sliceSamples(x, 16000, 0.5, 1.5)[0], 8000);
  assert.equal(sliceSamples(x, 16000, null, null).length, 32000);
  assert.equal(sliceSamples(x, 16000, 1.5, 99).length, 8000);
  assert.equal(sliceSamples(x, 16000, 5, 6).length, 0);
});

test('parseWav rejects garbage; streaming data size tolerated', () => {
  assert.throws(() => parseWav(Buffer.from('not a wav file at all')), /RIFF/);
  const buf = encodeWav([ramp(100)], 16000);
  buf.writeUInt32LE(0xffffffff, 40);
  assert.equal(parseWav(buf).frames, 100);
});
