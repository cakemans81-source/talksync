/**
 * 실시간 피더: 오디오를 chunkMs 단위로 잘라 1x 속도로 yield.
 * 청크는 해당 구간 끝 시각에 맞춰 방출 (실시간 마이크와 동일한 도착 시점).
 */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * @param {Float32Array} samples
 * @param {{sampleRate?:number, chunkMs?:number, fast?:boolean}} [opts]
 * @yields {{samples:Float32Array, index:number, audioTimeSec:number, endTimeSec:number, last:boolean, wallTimeMs:number}}
 *   audioTimeSec = 청크 시작의 오디오 시각, wallTimeMs = 방출 시점 performance.now()
 */
export async function* streamChunks(samples, { sampleRate = 16000, chunkMs = 100, fast = false } = {}) {
  const size = Math.max(1, Math.round((sampleRate * chunkMs) / 1000));
  const total = Math.ceil(samples.length / size);
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    const a = i * size;
    const b = Math.min(samples.length, a + size);
    const endTimeSec = b / sampleRate;
    if (!fast) {
      const wait = t0 + endTimeSec * 1000 - performance.now();
      if (wait > 0) await sleep(wait);
    }
    yield {
      samples: samples.subarray(a, b),
      index: i,
      audioTimeSec: a / sampleRate,
      endTimeSec,
      last: i === total - 1,
      wallTimeMs: performance.now(),
    };
  }
}
