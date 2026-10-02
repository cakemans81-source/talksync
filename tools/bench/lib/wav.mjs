/**
 * WAV 입출력 + 16 kHz mono Float32 변환 (무의존성).
 * 지원: PCM 8/16/24/32-bit, IEEE float 32/64, WAVE_FORMAT_EXTENSIBLE, mono/stereo+.
 */
import { readFileSync } from 'node:fs';

export const TARGET_RATE = 16000;

/** @returns {{sampleRate:number, channels:number, bitsPerSample:number, format:'pcm'|'float', frames:number, channelData:Float32Array[]}} */
export function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let fmt = null;
  let data = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (body + size > buf.length) size = buf.length - body; // 스트리밍 WAV(size 0xFFFFFFFF) 대응
    if (id === 'fmt ') {
      let tag = buf.readUInt16LE(body);
      if (tag === 0xfffe && size >= 26) tag = buf.readUInt16LE(body + 24); // extensible subformat
      fmt = {
        tag,
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
      break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt) throw new Error('missing fmt chunk');
  if (!data) throw new Error('missing data chunk');
  const { tag, channels, sampleRate, bits } = fmt;
  if (channels < 1) throw new Error('invalid channel count');
  if (tag !== 1 && tag !== 3) throw new Error(`unsupported WAV format tag ${tag}`);
  const isFloat = tag === 3;
  if (!(isFloat ? bits === 32 || bits === 64 : [8, 16, 24, 32].includes(bits))) {
    throw new Error(`unsupported bit depth ${bits} (${isFloat ? 'float' : 'pcm'})`);
  }
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const channelData = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const o = (f * channels + c) * bytes;
      let v;
      if (isFloat) v = bits === 32 ? data.readFloatLE(o) : data.readDoubleLE(o);
      else if (bits === 8) v = (data[o] - 128) / 128;
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      channelData[c][f] = v;
    }
  }
  return { sampleRate, channels, bitsPerSample: bits, format: isFloat ? 'float' : 'pcm', frames, channelData };
}

export function downmixToMono(channelData) {
  if (channelData.length === 1) return channelData[0];
  const n = channelData[0].length;
  const out = new Float32Array(n);
  for (const ch of channelData) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channelData.length;
  return out;
}

/** 선형 보간 리샘플. 다운샘플 시 저역통과 없음(앨리어싱 소량) — 벤치 용도로 허용. */
export function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const n = Math.round((samples.length * toRate) / fromRate);
  const out = new Float32Array(n);
  const step = fromRate / toRate;
  const last = samples.length - 1;
  for (let i = 0; i < n; i++) {
    const p = i * step;
    const i0 = Math.min(Math.floor(p), last);
    const i1 = Math.min(i0 + 1, last);
    const frac = p - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** startSec/endSec(null 허용)로 자른 복사본을 반환. 범위는 클램프. */
export function sliceSamples(samples, sampleRate, startSec = null, endSec = null) {
  const a = Math.max(0, Math.round((startSec ?? 0) * sampleRate));
  const b = Math.min(samples.length, endSec == null ? samples.length : Math.round(endSec * sampleRate));
  return b > a ? samples.slice(a, b) : new Float32Array(0);
}

export function toMono16k(wav) {
  return resampleLinear(downmixToMono(wav.channelData), wav.sampleRate, TARGET_RATE);
}

/** WAV 파일 → 16 kHz mono Float32 (구간 슬라이스 포함). */
export function loadAudio16k(file, startSec = null, endSec = null) {
  const samples = toMono16k(parseWav(readFileSync(file)));
  return sliceSamples(samples, TARGET_RATE, startSec, endSec);
}

/** Float32 채널 배열 → WAV Buffer. format: 'pcm16'(기본) | 'float32'. */
export function encodeWav(channelData, sampleRate, format = 'pcm16') {
  const channels = channelData.length;
  const frames = channelData[0].length;
  const bytes = format === 'float32' ? 4 : 2;
  const dataLen = frames * channels * bytes;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(format === 'float32' ? 3 : 1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytes, 28);
  buf.writeUInt16LE(channels * bytes, 32);
  buf.writeUInt16LE(bytes * 8, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  let o = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, channelData[c][f]));
      if (format === 'float32') buf.writeFloatLE(v, o);
      else buf.writeInt16LE(Math.round(v * 32767), o);
      o += bytes;
    }
  }
  return buf;
}
