/**
 * Dummy ASR: 세그먼트 끝(flush) + delayMs 후 refText를 final로 방출. 지연 계산 검증용.
 * createStream({ refText })의 refText 힌트는 더미 전용 — 실제 어댑터는 무시한다.
 */
import { performance } from 'node:perf_hooks';

const cfg = { delayMs: 300 };

const adapter = {
  name: 'asr-dummy',

  async init(opts = {}) {
    cfg.delayMs = Number(opts.delayMs ?? 300);
  },

  createStream(ctx = {}) {
    const text = ctx.refText ?? '';
    let emit = () => {};
    let audioEnd = 0;
    return {
      onEvent(cb) {
        emit = cb;
      },
      acceptAudio(samples, audioTimeSec) {
        audioEnd = audioTimeSec + samples.length / 16000;
      },
      flush() {
        const partial = text.slice(0, Math.ceil(text.length / 2));
        if (partial) emit({ type: 'partial', text: partial, audioTimeSec: audioEnd, wallTimeMs: performance.now() });
        return new Promise((resolve) => {
          setTimeout(() => {
            emit({ type: 'final', text, audioTimeSec: audioEnd, wallTimeMs: performance.now() });
            resolve();
          }, cfg.delayMs);
        });
      },
    };
  },
};

export default adapter;
