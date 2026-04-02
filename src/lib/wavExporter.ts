/**
 * wavExporter.ts — Raw PCM → RIFF/WAV 무손실 인코더 + 자동 저장
 *
 * ● 브라우저: URL.createObjectURL(Blob) + anchor 클릭 → 다운로드
 * ● Electron: electronAPI.saveWav(buffer, filename) IPC → fs.writeFile 저장
 *
 * 스펙: Int16 LE, Mono or Stereo, 가변 샘플레이트 (Gemini Live: 24000 Hz)
 */

// ─────────────────────────────────────────────────────────────────────────────
// RIFF / WAV 헤더 빌더
// ─────────────────────────────────────────────────────────────────────────────

export interface WavSpec {
  /** 샘플레이트 (Hz). Gemini Live 출력: 24000, 시스템 캡처: 16000 */
  sampleRate: number;
  /** 채널 수. 1 = Mono (Gemini Live), 2 = Stereo */
  numChannels: 1 | 2;
  /** 샘플 비트 깊이. 16 고정 (Int16 LE PCM) */
  bitsPerSample: 16;
}

/**
 * RIFF/WAV 헤더 44 바이트를 DataView에 기록
 *
 * WAV 구조:
 *   [RIFF chunk 12B] + [fmt  sub-chunk 24B] + [data sub-chunk header 8B] + [PCM data]
 */
function writeWavHeader(view: DataView, pcmByteLen: number, spec: WavSpec): void {
  const { sampleRate, numChannels, bitsPerSample } = spec;
  const blockAlign  = numChannels * (bitsPerSample / 8);
  const byteRate    = sampleRate * blockAlign;
  const totalBytes  = 36 + pcmByteLen; // ChunkSize = 36 + dataSize

  let o = 0; // byte offset

  // ── RIFF 청크 ────────────────────────────────────────────────
  view.setUint8(o++, 0x52); // 'R'
  view.setUint8(o++, 0x49); // 'I'
  view.setUint8(o++, 0x46); // 'F'
  view.setUint8(o++, 0x46); // 'F'
  view.setUint32(o, totalBytes, true); o += 4; // ChunkSize (LE)
  view.setUint8(o++, 0x57); // 'W'
  view.setUint8(o++, 0x41); // 'A'
  view.setUint8(o++, 0x56); // 'V'
  view.setUint8(o++, 0x45); // 'E'

  // ── fmt 서브청크 ──────────────────────────────────────────────
  view.setUint8(o++, 0x66); // 'f'
  view.setUint8(o++, 0x6D); // 'm'
  view.setUint8(o++, 0x74); // 't'
  view.setUint8(o++, 0x20); // ' '
  view.setUint32(o, 16, true); o += 4;           // Subchunk1Size = 16 (PCM)
  view.setUint16(o, 1, true);  o += 2;           // AudioFormat = 1 (Linear PCM)
  view.setUint16(o, numChannels, true); o += 2;  // NumChannels
  view.setUint32(o, sampleRate, true);  o += 4;  // SampleRate
  view.setUint32(o, byteRate, true);   o += 4;  // ByteRate
  view.setUint16(o, blockAlign, true); o += 2;   // BlockAlign
  view.setUint16(o, bitsPerSample, true); o += 2; // BitsPerSample

  // ── data 서브청크 헤더 ────────────────────────────────────────
  view.setUint8(o++, 0x64); // 'd'
  view.setUint8(o++, 0x61); // 'a'
  view.setUint8(o++, 0x74); // 't'
  view.setUint8(o++, 0x61); // 'a'
  view.setUint32(o, pcmByteLen, true); // Subchunk2Size
}

// ─────────────────────────────────────────────────────────────────────────────
// Float32Array → Int16 LE PCM 변환
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Web Audio API Float32 샘플 [-1, 1] → Int16 LE PCM 바이트 배열
 * 클리핑(±32767) 처리 포함
 */
export function float32ToInt16Bytes(float32: Float32Array): Uint8Array {
  const int16Buf = new ArrayBuffer(float32.length * 2);
  const int16    = new Int16Array(int16Buf);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return new Uint8Array(int16Buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// WAV Blob 생성
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Int16 LE PCM 바이트 시퀀스(청크 배열)를 완전한 WAV Blob으로 변환
 *
 * @param pcmChunks  Int16 LE PCM 바이트 청크 목록 (순서 보장)
 * @param spec       샘플레이트 / 채널 / 비트 깊이
 * @returns          audio/wav MIME Blob
 */
export function buildWavBlob(pcmChunks: Uint8Array[], spec: WavSpec): Blob {
  // 전체 PCM 바이트 합산
  const totalPcmBytes = pcmChunks.reduce((acc, c) => acc + c.byteLength, 0);
  const wavBuf = new ArrayBuffer(44 + totalPcmBytes);

  // 헤더 기록
  writeWavHeader(new DataView(wavBuf), totalPcmBytes, spec);

  // PCM 데이터 이어 붙이기
  const wavBytes = new Uint8Array(wavBuf);
  let offset = 44;
  for (const chunk of pcmChunks) {
    wavBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Blob([wavBuf], { type: 'audio/wav' });
}

// ─────────────────────────────────────────────────────────────────────────────
// 자동 저장 트리거
// ─────────────────────────────────────────────────────────────────────────────

/** Electron IPC 브릿지 타입 (preload.ts에서 노출) */
type ElectronAPI = {
  saveWav?: (buffer: ArrayBuffer, filename: string) => Promise<void>;
};

/**
 * WAV Blob을 물리 파일로 즉시 저장
 *
 * ● Electron 환경 → electronAPI.saveWav() IPC 경유 → fs.writeFile
 * ● 브라우저 환경 → <a download> 트릭으로 강제 다운로드
 *
 * @param blob      buildWavBlob()이 반환한 audio/wav Blob
 * @param filename  저장 파일명 (예: "TalkSync_통역_20260402_085510.wav")
 */
export async function saveWavFile(blob: Blob, filename: string): Promise<void> {
  const electronAPI = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;

  if (electronAPI?.saveWav) {
    // ── Electron 경로: IPC로 메인 프로세스에 ArrayBuffer 전달 ──
    const arrayBuffer = await blob.arrayBuffer();
    await electronAPI.saveWav(arrayBuffer, filename);
    console.log(`[WavExporter] Electron 저장 완료 → ${filename}`);
  } else {
    // ── 브라우저 경로: Object URL + <a> 클릭으로 강제 다운로드 ──
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    // 동기 클릭 이후 정리 (60초 후 URL 해제)
    setTimeout(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    }, 60_000);
    console.log(`[WavExporter] 브라우저 다운로드 트리거 → ${filename}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 타임스탬프 파일명 생성
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "TalkSync_통역_YYYYMMDD_HHMMSS_mmm.wav" 형태의 고유 파일명 생성
 * 밀리초 접미사로 같은 초에 생성된 파일 충돌 방지
 */
export function makeTalkSyncFilename(prefix = 'TalkSync_통역'): string {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  const ms   = pad3(now.getMilliseconds());
  return `${prefix}_${date}_${time}_${ms}.wav`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 고수준 통합 헬퍼 — WAV Accumulator (클래스)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PCM 청크를 누적하고 flush() 시 WAV 파일로 자동 저장하는 스테이트풀 어큐뮬레이터
 *
 * 사용 패턴:
 *   const acc = new WavAccumulator({ sampleRate: 24000, numChannels: 1, bitsPerSample: 16 });
 *
 *   // 각 PCM 청크 수신 시:
 *   acc.push(float32Chunk);           // Float32Array 입력
 *   // 또는
 *   acc.pushInt16Bytes(int16Bytes);   // 이미 Int16 바이트인 경우
 *
 *   // 턴(발화) 완료 시:
 *   await acc.flush();                // → WAV 파일 자동 저장 후 버퍼 초기화
 *
 *   // 최소 크기 미달 청크 무시 (잡음 방지):
 *   await acc.flush({ minSamples: 4800 }); // 24kHz 기준 0.2초 미만 드롭
 */
export class WavAccumulator {
  private readonly spec: WavSpec;
  private chunks: Uint8Array[] = [];
  private totalSamples = 0;
  private readonly prefix: string;

  constructor(spec: WavSpec, prefix = 'TalkSync_통역') {
    this.spec = spec;
    this.prefix = prefix;
  }

  /** Float32 샘플 청크 추가 */
  push(float32: Float32Array): void {
    const bytes = float32ToInt16Bytes(float32);
    this.chunks.push(bytes);
    this.totalSamples += float32.length;
  }

  /** 이미 Int16 LE 바이트 배열인 경우 직접 추가 */
  pushInt16Bytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.totalSamples += bytes.byteLength / 2;
  }

  /** 누적된 샘플 수 */
  get samples(): number { return this.totalSamples; }

  /** 누적된 오디오 길이 (초) */
  get durationSec(): number { return this.totalSamples / this.spec.sampleRate; }

  /** 버퍼가 비어 있는지 */
  get isEmpty(): boolean { return this.chunks.length === 0; }

  /**
   * 현재 버퍼를 WAV 파일로 저장 후 버퍼 초기화
   *
   * @param opts.minSamples  이보다 적은 샘플이면 저장 스킵 (기본: 1600 = 24kHz 67ms)
   * @param opts.filename    파일명 직접 지정 (생략 시 자동 타임스탬프)
   */
  async flush(opts?: { minSamples?: number; filename?: string }): Promise<void> {
    const minSamples = opts?.minSamples ?? 1600;

    if (this.isEmpty || this.totalSamples < minSamples) {
      console.log(`[WavAccumulator] flush 스킵 — 샘플 부족 (${this.totalSamples} < ${minSamples})`);
      this.reset();
      return;
    }

    const filename = opts?.filename ?? makeTalkSyncFilename(this.prefix);
    const blob = buildWavBlob(this.chunks, this.spec);

    console.log(
      `[WavAccumulator] flush → ${filename}` +
      ` | ${this.durationSec.toFixed(2)}s` +
      ` | ${(blob.size / 1024).toFixed(1)} KB`
    );

    this.reset();
    await saveWavFile(blob, filename);
  }

  /** 버퍼만 초기화 (저장 없음) */
  reset(): void {
    this.chunks = [];
    this.totalSamples = 0;
  }
}
