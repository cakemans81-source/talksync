/**
 * rmsVadEngine.ts — RMS 폴백 VAD 상태 머신 (Web Audio 비의존, 순수 로직)
 *
 * systemAudioCapture.ts의 RMS 폴백이 오디오 스레드 콜백(ScriptProcessor)에서 받은
 * "연속된, 겹치지 않는" PCM 블록을 그대로 넣는다. 각 샘플은 정확히 한 번만 출력된다.
 *
 * 모드
 *   - batch (onSpeechFrame 없음): 발화 종료 시 발화 구간 전체 PCM을 onSpeechEnd로 전달
 *   - streaming + speech:      발화 중 chunkSamples 단위로 onSpeechFrame, 종료 시 빈 onSpeechEnd
 *   - streaming + continuous:  블록 RMS ≥ minRms 인 동안 계속 onSpeechFrame,
 *                              조용한 블록에서 잔여 flush + 빈 onSpeechEnd (Silero continuous 경로와 동일)
 *
 * 시간 판단은 Date.now()/타이머가 아니라 처리한 샘플 수로 한다
 * → 창 최소화/백그라운드 타이머 스로틀링과 무관하게 동작.
 */

export type RmsVadEngineOptions = {
  /** 입력 블록 샘플레이트 (Hz) */
  sampleRate: number;
  /** 발화 판단 RMS 임계값 */
  minRms: number;
  /** 발화 중 이 시간 이상 조용하면 발화 종료 (ms) */
  rmsTimeoutMs: number;
  /** 최소 발화 인정 시간 (ms) — 미만이면 버림 (기침/잡음) */
  minSpeechMs: number;
  /** 무한 발화 하드 캡 (ms) — 초과 시 강제 종료 */
  maxSpeechMs: number;
  /** 'continuous'는 streaming일 때만 의미가 있다 (Silero 경로와 동일) */
  streamMode: 'speech' | 'continuous';
  /** onSpeechFrame 스트리밍 사용 여부 */
  streaming: boolean;
  /** 스트리밍 프레임 크기 (샘플). 기본: sampleRate × 0.1 (100ms) */
  chunkSamples?: number;
};

export type RmsVadEngineEvents = {
  onSpeechStart: () => void;
  /** batch: 발화 PCM (후행 침묵 제외) / streaming: 빈 배열 (종료 신호) */
  onSpeechEnd: (audio: Float32Array) => void;
  /** streaming 전용: chunkSamples 길이(마지막 flush는 더 짧을 수 있음)의 PCM */
  onSpeechFrame: (pcm: Float32Array) => void;
};

export type RmsVadEngine = {
  /** 연속 PCM 블록 1개 처리. block은 호출 후 재사용될 수 있으므로 내부에서 복사한다. */
  process: (block: Float32Array, muted: boolean) => void;
  /** 상태/버퍼 초기화 (콜백 호출 없음) */
  reset: () => void;
};

export function blockRms(block: Float32Array): number {
  if (block.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
  return Math.sqrt(sum / block.length);
}

export function createRmsVadEngine(
  options: RmsVadEngineOptions,
  events: RmsVadEngineEvents
): RmsVadEngine {
  const { sampleRate, minRms, streamMode, streaming } = options;
  const msToSamples = (ms: number) => Math.round((ms / 1000) * sampleRate);
  const timeoutSamples = msToSamples(options.rmsTimeoutMs);
  const minSpeechSamples = msToSamples(options.minSpeechMs);
  const maxSpeechSamples = msToSamples(options.maxSpeechMs);
  const chunkSamples = Math.max(1, options.chunkSamples ?? Math.round(sampleRate * 0.1));
  const continuous = streaming && streamMode === 'continuous';

  let isSpeaking = false;
  /** 발화 시작 이후 누적 샘플 수 (중간/후행 침묵 포함) */
  let speechSamples = 0;
  /** 현재 이어지는 침묵 샘플 수 */
  let silenceSamples = 0;
  /** batch 모드: 발화 구간 블록 복사본 */
  let batchBlocks: Float32Array[] = [];

  // streaming 모드: 고정 크기 누적 버퍼 (프레임 단위 할당 1회)
  const pending = new Float32Array(chunkSamples);
  let pendingLen = 0;

  const pushStream = (block: Float32Array) => {
    let offset = 0;
    while (offset < block.length) {
      const n = Math.min(chunkSamples - pendingLen, block.length - offset);
      pending.set(block.subarray(offset, offset + n), pendingLen);
      pendingLen += n;
      offset += n;
      if (pendingLen === chunkSamples) {
        events.onSpeechFrame(pending.slice(0, pendingLen));
        pendingLen = 0;
      }
    }
  };

  const flushStream = () => {
    if (pendingLen === 0) return;
    const out = pending.slice(0, pendingLen);
    pendingLen = 0;
    events.onSpeechFrame(out);
  };

  const reset = () => {
    isSpeaking = false;
    speechSamples = 0;
    silenceSamples = 0;
    batchBlocks = [];
    pendingLen = 0;
  };

  const collectBatch = (trimTailSamples: number): Float32Array => {
    const total = batchBlocks.reduce((s, b) => s + b.length, 0);
    const length = Math.max(0, total - trimTailSamples);
    const combined = new Float32Array(length);
    let offset = 0;
    for (const b of batchBlocks) {
      if (offset >= length) break;
      const n = Math.min(b.length, length - offset);
      combined.set(n === b.length ? b : b.subarray(0, n), offset);
      offset += n;
    }
    return combined;
  };

  /** 발화 종료 처리. forced=true: maxSpeechMs 강제 종료 (minSpeechMs 게이트 생략) */
  const endSpeech = (forced: boolean) => {
    const voicedSamples = speechSamples - silenceSamples;
    const tooShort = !forced && voicedSamples < minSpeechSamples;

    if (streaming) {
      if (tooShort) {
        // misfire: 아직 보내지 않은 잔여 프레임 폐기, 종료 신호 없음 (Silero onVADMisfire와 동일)
        pendingLen = 0;
      } else {
        flushStream();
        events.onSpeechEnd(new Float32Array(0));
      }
    } else if (!tooShort) {
      events.onSpeechEnd(collectBatch(silenceSamples));
    }

    isSpeaking = false;
    speechSamples = 0;
    silenceSamples = 0;
    batchBlocks = [];
  };

  const process = (block: Float32Array, muted: boolean) => {
    if (block.length === 0) return;

    if (muted) {
      // AEC 게이트 활성화 — 진행 중 발화/버퍼 폐기 (콜백 없음)
      reset();
      return;
    }

    const loud = blockRms(block) >= minRms;

    if (continuous) {
      if (!loud) {
        flushStream();
        if (isSpeaking) events.onSpeechEnd(new Float32Array(0));
        isSpeaking = false;
        return;
      }
      if (!isSpeaking) {
        isSpeaking = true;
        events.onSpeechStart();
      }
      pushStream(block);
      return;
    }

    if (loud) {
      if (!isSpeaking) {
        isSpeaking = true;
        speechSamples = 0;
        silenceSamples = 0;
        batchBlocks = [];
        pendingLen = 0;
        events.onSpeechStart();
      }
      silenceSamples = 0;
    } else if (!isSpeaking) {
      return; // 발화 밖의 침묵 → 무시
    } else {
      silenceSamples += block.length;
    }

    speechSamples += block.length;
    if (streaming) pushStream(block);
    else batchBlocks.push(block.slice());

    if (silenceSamples >= timeoutSamples) {
      endSpeech(false);
    } else if (speechSamples >= maxSpeechSamples) {
      console.warn('[RMS VAD] maxSpeechMs 도달 → 강제 EoT');
      endSpeech(true);
    }
  };

  return { process, reset };
}
