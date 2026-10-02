/**
 * 프로세스 CPU%/RSS 샘플러.
 * 현재는 in-process 엔진 전용(process.cpuUsage / process.memoryUsage.rss). CPU%는 코어 1개=100%, 멀티스레드면 >100.
 * TODO(M1): out-of-process 엔진(utilityProcess/자식 프로세스)은 `probe` 훅으로
 * {cpuPct, rssMB}를 돌려주는 PID 샘플러를 추가해 합산한다. (os.loadavg는 Windows에서 항상 0이라 사용 안 함)
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';

const MIN_DT_MS = 5;

export class SysMon {
  /** @param {{intervalMs?:number, probe?:(()=>{cpuPct?:number, rssMB?:number})|null}} [opts] */
  constructor({ intervalMs = 100, probe = null } = {}) {
    this.intervalMs = intervalMs;
    this.probe = probe;
    this.samples = [];
    this.timer = null;
    this.last = null;
    this.cpus = os.cpus().length;
  }

  sample() {
    const t = performance.now();
    const cpu = process.cpuUsage();
    let cpuPct = null;
    if (this.last && t - this.last.t >= MIN_DT_MS) {
      const used = cpu.user - this.last.cpu.user + (cpu.system - this.last.cpu.system);
      cpuPct = (used / ((t - this.last.t) * 1000)) * 100;
    }
    if (cpuPct !== null || !this.last) this.last = { t, cpu };
    let rssMB = process.memoryUsage.rss() / 1048576;
    if (this.probe) {
      const x = this.probe() ?? {};
      if (cpuPct !== null) cpuPct += x.cpuPct ?? 0;
      rssMB += x.rssMB ?? 0;
    }
    const s = { t, cpuPct, rssMB };
    this.samples.push(s);
    return s;
  }

  start() {
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sample();
    return this.summarize();
  }

  /** [from, to] 구간(performance.now 기준) 요약 */
  summarize(from = -Infinity, to = Infinity) {
    const s = this.samples.filter((x) => x.t >= from && x.t <= to);
    const cpu = s.map((x) => x.cpuPct).filter((x) => x !== null);
    return {
      n: s.length,
      cpuPeakPct: cpu.length ? Math.max(...cpu) : null,
      cpuAvgPct: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : null,
      rssPeakMB: s.length ? Math.max(...s.map((x) => x.rssMB)) : null,
    };
  }

  /** 구간 측정: const w = mon.startWindow(); ...; const r = mon.endWindow(w); */
  startWindow() {
    this.sample();
    return { t0: performance.now() };
  }

  endWindow(w) {
    this.sample();
    return this.summarize(w.t0, Infinity);
  }
}
