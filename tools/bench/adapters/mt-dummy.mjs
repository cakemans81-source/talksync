/** Dummy MT: 입력을 그대로 에코. 첫 토큰 firstTokenMs, 이후 토큰마다 tokenMs 지연. */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const cfg = { firstTokenMs: 100, tokenMs: 20 };

const adapter = {
  name: 'mt-dummy',

  async init(opts = {}) {
    cfg.firstTokenMs = Number(opts.firstTokenMs ?? 100);
    cfg.tokenMs = Number(opts.tokenMs ?? 20);
  },

  async *translate(text) {
    const tokens = text.match(/\S+\s*/g) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      await sleep(i === 0 ? cfg.firstTokenMs : cfg.tokenMs);
      yield { token: tokens[i], wallTimeMs: performance.now() };
    }
  },
};

export default adapter;
