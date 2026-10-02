/**
 * 합성 샘플 WAV 생성 (data/sample/*.wav) — 실제 데이터 없이 테스트/스모크 실행용.
 * 사용: node tools/bench/make-sample-data.mjs [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWav } from './lib/wav.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function sine(sampleRate, sec, hz, amp = 0.4) {
  const out = new Float32Array(Math.round(sampleRate * sec));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/** @returns {string[]} 생성된 파일 경로 */
export function generateSampleData(dataDir = path.join(HERE, 'data')) {
  const dir = path.join(dataDir, 'sample');
  mkdirSync(dir, { recursive: true });
  const files = {
    // 16 kHz mono PCM16 사인파 1.0s
    'en-sine.wav': encodeWav([sine(16000, 1, 440)], 16000),
    // 16 kHz mono PCM16 무음 1.5s
    'ko-silence.wav': encodeWav([new Float32Array(24000)], 16000),
    // 44.1 kHz stereo PCM16 2.0s (리샘플/다운믹스 경로 검증, 매니페스트에서 0.5~1.5s 슬라이스)
    'ja-stereo.wav': encodeWav([sine(44100, 2, 330), sine(44100, 2, 660)], 44100),
  };
  return Object.entries(files).map(([name, buf]) => {
    const p = path.join(dir, name);
    writeFileSync(p, buf);
    return p;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  for (const f of generateSampleData(out)) console.log('wrote', f);
}
