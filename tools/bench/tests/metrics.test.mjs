import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, editDistance, wer, cer, asrError, chrf, chrfStats, chrfFromStats, sumChrfStats, percentile, latencySummary,
} from '../lib/metrics.mjs';

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('normalizeText: NFKC, lowercase, punctuation', () => {
  assert.equal(normalizeText('Ｈello,  World!'), 'hello world');
  assert.equal(normalizeText("Don't stop-me"), 'dont stop me');
});

test('editDistance', () => {
  assert.equal(editDistance(['a', 'b', 'c'], ['a', 'c']), 1);
  assert.equal(editDistance([], ['x', 'y']), 2);
  assert.equal(editDistance(Array.from('kitten'), Array.from('sitting')), 3);
});

test('WER: 1 substitution + 1 deletion over 4 words', () => {
  const r = wer('the cat sat down', 'The dog sat');
  assert.deepEqual([r.errors, r.refLen, r.rate], [2, 4, 0.5]);
});

test('WER: insertions can exceed 1; empty ref', () => {
  assert.equal(wer('a', 'a b c').rate, 2);
  assert.equal(wer('', '').rate, 0);
  assert.equal(wer('', 'x').rate, 1);
});

test('CER: ignores spaces and punctuation, character level', () => {
  const r = cer('안녕하세요 반갑습니다.', '안녕하세요반갑습니다');
  assert.equal(r.errors, 0);
  assert.equal(r.refLen, 10);
  const j = cer('こんにちは、世界', 'こんにちは世果');
  assert.deepEqual([j.errors, j.refLen], [1, 7]);
});

test('asrError picks metric by language', () => {
  assert.equal(asrError('ko', 'a b', 'a b').metric, 'cer');
  assert.equal(asrError('ja-JP', 'a', 'a').metric, 'cer');
  assert.equal(asrError('en', 'a b', 'a').metric, 'wer');
});

test('chrF: identical = 100, disjoint = 0, both empty = 100', () => {
  near(chrf('hello world', 'hello world'), 100);
  near(chrf('abc', 'xyz'), 0);
  near(chrf('', ''), 100);
  near(chrf('abc', ''), 0);
});

test('chrF2 hand-computed: hyp "abc" vs ref "abcd"', () => {
  // n=1: P=3/3 R=3/4, n=2: P=2/2 R=2/3, n=3: P=1/1 R=1/2 (n>=4: hyp has no n-grams, skipped)
  // avgP=1, avgR=(0.75+0.6667+0.5)/3=0.63889, F2=5PR/(4P+R)=0.68862
  near(chrf('abc', 'abcd'), 68.862);
  const st = chrfStats('abc', 'abcd');
  assert.deepEqual(st[0], { hyp: 3, ref: 4, match: 3 });
  assert.deepEqual(st[3], { hyp: 0, ref: 1, match: 0 });
});

test('chrF: whitespace ignored, beta weights recall', () => {
  near(chrf('a b c', 'abc'), 100);
  // beta=2: 재현율 손실(짧은 hyp)이 정밀도 손실(긴 hyp)보다 더 크게 감점
  assert.ok(chrf('abc', 'abcdef') < chrf('abcdef', 'abc'));
});

test('chrF corpus aggregation sums n-gram stats', () => {
  const a = chrfStats('abc', 'abcd');
  const b = chrfStats('xy', 'xy');
  const sum = sumChrfStats([a, b]);
  assert.equal(sum[0].match, 5);
  assert.equal(sum[0].hyp, 5);
  near(chrfFromStats(sum), chrfFromStats(sumChrfStats([b, a])));
});

test('percentile: nearest-rank', () => {
  const v = [15, 20, 35, 40, 50];
  assert.equal(percentile(v, 50), 35);
  assert.equal(percentile(v, 95), 50);
  assert.equal(percentile(v, 0), 15);
  assert.equal(percentile([], 50), null);
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(hundred, 95), 95);
  assert.equal(percentile(hundred.reverse(), 50), 50);
});

test('latencySummary', () => {
  const s = latencySummary([100, 200, 300, null, NaN]);
  assert.deepEqual([s.n, s.mean, s.p50, s.p95, s.max], [3, 200, 200, 300, 300]);
  assert.equal(latencySummary([]).p95, null);
});
