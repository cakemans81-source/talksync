'use client';

import { transcribeAudio } from './gemini';

// ─────────────────────────────────────────────
// Dual STT Manager — 초저지연 설계
//
// 지연 최소화 전략:
//   1. interimResults: true → 발화 중에도 실시간 텍스트 수신 (UI 즉시 표시)
//   2. isFinal=true → 확정된 텍스트만 번역 엔진으로 전달 (정확도 보장)
//   3. VAD 침묵 감지 백업 → isFinal이 늦게 오면 침묵으로 번역 트리거
//   4. continuous: true → 발화가 이어지면 STT가 중단 없이 인식 유지
// ─────────────────────────────────────────────

export type STTLanguage = string;

type RecognizerConfig = {
  lang: STTLanguage;
  onFinalTranscript: (text: string) => void;    // 확정 결과 → 번역 트리거
  onInterimTranscript?: (text: string) => void; // 중간 결과 → UI 즉시 표시
  onError?: (error: string) => void;
};

function createRecognizer(config: RecognizerConfig): SpeechRecognition {
  const SpeechRecognitionClass: typeof SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionClass) {
    throw new Error('Web Speech API 미지원 — Chrome 브라우저를 사용해주세요.');
  }

  const r = new SpeechRecognitionClass();
  r.lang = config.lang;
  r.continuous = true;
  r.interimResults = true; // ← 핵심: 중간 결과 수신으로 자막 즉시 표시
  r.maxAlternatives = 1;

  r.onstart = () => console.log(`[STT] started lang=${config.lang}`);

  r.onresult = (event: SpeechRecognitionEvent) => {
    console.log(`[STT] onresult resultIndex=${event.resultIndex} results=${event.results.length}`);
    let interimText = '';
    let finalText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    // 중간 결과: UI에만 표시 (번역 없음 - API 절약)
    if (interimText && config.onInterimTranscript) {
      config.onInterimTranscript(interimText.trim());
    }

    // 최종 결과: 번역 엔진으로 전달
    if (finalText) {
      config.onFinalTranscript(finalText.trim());
    }
  };

  r.onerror = (event: SpeechRecognitionErrorEvent) => {
    console.warn(`[STT] error lang=${config.lang} error=${event.error}`);
    if (event.error === 'no-speech') return;
    if (event.error === 'aborted') return;
    if (event.error === 'network') return;
    config.onError?.(event.error);
  };

  r.onend = () => {
    console.log(`[STT] ended lang=${config.lang}, restarting...`);
    setTimeout(() => {
      try { r.start(); } catch { /* 이미 시작 중 */ }
    }, 100);
  };

  return r;
}

// ─────────────────────────────────────────────
// Chrome/Electron은 SpeechRecognition 하나만 동시 실행 가능.
// mic(2초) → sys(2초) → mic(2초) ... 형태로 시간분할 방식으로 교대 실행.
export class DualSTTManager {
  private activeRecognizer: InstanceType<typeof SpeechRecognition> | null = null;
  private isRunning = false;
  private slotTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSlot: 'mic' | 'sys' = 'mic';
  private readonly MIC_SLOT_MS = 3000;
  private readonly SYS_SLOT_MS = 2000;

  constructor(
    private readonly micLang: STTLanguage,
    private readonly sysLang: STTLanguage,
    private readonly onMicFinal: (text: string) => void,
    private readonly onSysFinal: (text: string) => void,
    private readonly onMicInterim?: (text: string) => void,
    private readonly onSysInterim?: (text: string) => void,
    private readonly onError?: (source: 'mic' | 'sys', error: string) => void
  ) {}

  private startSlot(slot: 'mic' | 'sys'): void {
    if (!this.isRunning) return;
    this.currentSlot = slot;

    const config = slot === 'mic'
      ? { lang: this.micLang, onFinalTranscript: this.onMicFinal, onInterimTranscript: this.onMicInterim, onError: (e: string) => this.onError?.('mic', e) }
      : { lang: this.sysLang, onFinalTranscript: this.onSysFinal, onInterimTranscript: this.onSysInterim, onError: (e: string) => this.onError?.('sys', e) };

    // 이전 recognizer 종료
    if (this.activeRecognizer) {
      this.activeRecognizer.onend = null;
      try { this.activeRecognizer.stop(); } catch { /* ignore */ }
      this.activeRecognizer = null;
    }

    const r = createRecognizer(config);
    // 슬롯 시간 내 onend는 재시작 금지 (타이머가 제어)
    r.onend = null;
    this.activeRecognizer = r;

    try { r.start(); } catch { /* ignore */ }

    const slotMs = slot === 'mic' ? this.MIC_SLOT_MS : this.SYS_SLOT_MS;
    this.slotTimer = setTimeout(() => {
      if (this.isRunning) this.startSlot(slot === 'mic' ? 'sys' : 'mic');
    }, slotMs);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startSlot('mic');
  }

  stop(): void {
    this.isRunning = false;
    if (this.slotTimer) { clearTimeout(this.slotTimer); this.slotTimer = null; }
    if (this.activeRecognizer) {
      this.activeRecognizer.onend = null;
      try { this.activeRecognizer.stop(); } catch { /* ignore */ }
      this.activeRecognizer = null;
    }
  }

  get running(): boolean { return this.isRunning; }
}

// ─────────────────────────────────────────────
// VAD (Voice Activity Detection) — 적응형 다중 지표 음성 감지
//
// 3중 방어선:
//   1. 고역통과 IIR 필터 — 에어컨·환풍기·마이크 취급 소음(~80Hz) 제거
//   2. 적응형 노이즈 플로어 — 침묵 청크를 학습해 환경 소음 수준 자동 추정
//      (조용한 방 0.005~, 시끄러운 환경 0.015~ 자동 보정)
//   3. 활성 프레임 비율 — 3초 중 20ms 단위 프레임이 20% 이상 활성이어야 통과
//      (클릭·팝 소음: 순간 고진폭 → 활성 비율 낮음 → 차단)
//      (정상 발화: 지속적 활성 → 활성 비율 높음 → 통과)
//
// 반환값: true = 발화 있음 (API 호출 허용) / false = 침묵·잡음 (API 차단)
// ─────────────────────────────────────────────

const VAD_FRAME_MS = 20; // 분석 프레임 단위 (ms)
// 고역통과 IIR 1차 필터 계수
// y[n] = α·(y[n-1] + x[n] - x[n-1])  →  fc ≈ (1-α)·fs/(2π) ≈ 80Hz @48kHz
const VAD_HPF_ALPHA = 0.99;

// 적응형 노이즈 플로어 (앱 세션 전체에서 유지 — 환경 자동 적응)
//
// ※ 임계값 조정 기준
//   - AGC(autoGainControl) ON 환경에서 정상 한국어 발화 RMS: 0.04~0.12
//   - 가정용 마이크 배경소음 RMS: 0.003~0.015
//   - 초기 speechThreshold = max(0.005 × 3.0, 0.010) = 0.015 → 0.04 이상이면 통과
const vadState = {
  noiseFloor: 0.005,       // 초기값 (첫 침묵 청크들이 빠르게 보정)
  SPEECH_MULT: 3.0,        // noiseFloor × 3 이상 = 발화 (5.5 → 3.0 완화)
  ABS_MIN: 0.010,          // 절대 최솟값 완화 (0.028 → 0.010)
  ACTIVE_RATIO_MIN: 0.08,  // 활성 프레임 최소 비율 완화 (0.18 → 0.08, 8% 이상)
  LEARN_RATE: 0.05,        // 노이즈 플로어 학습 속도
};

async function analyzeVAD(arrayBuffer: ArrayBuffer): Promise<boolean> {
  try {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await ctx.close();

    const samples = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    const frameSize = Math.round((sampleRate * VAD_FRAME_MS) / 1000);

    // ── 1단계: 고역통과 필터 (저주파 소음 제거) ─────────────────────
    const filtered = new Float32Array(samples.length);
    filtered[0] = samples[0];
    for (let i = 1; i < samples.length; i++) {
      filtered[i] = VAD_HPF_ALPHA * (filtered[i - 1] + samples[i] - samples[i - 1]);
    }

    // ── 2단계: 전체 RMS (필터링된 신호 기준) ────────────────────────
    let sumSq = 0;
    for (let i = 0; i < filtered.length; i++) sumSq += filtered[i] * filtered[i];
    const overallRms = Math.sqrt(sumSq / filtered.length);

    // ── 3단계: 적응형 임계값 산출 ───────────────────────────────────
    const speechThreshold = Math.max(
      vadState.noiseFloor * vadState.SPEECH_MULT,
      vadState.ABS_MIN,
    );
    const frameThreshold = speechThreshold * 0.65; // 프레임별은 전체보다 약간 낮게

    // ── 4단계: 프레임 활성 비율 계산 (클릭·팝 노이즈 제거) ──────────
    let activeFrames = 0;
    const totalFrames = Math.floor(filtered.length / frameSize);
    for (let f = 0; f < totalFrames; f++) {
      let fSumSq = 0;
      const start = f * frameSize;
      for (let i = start; i < start + frameSize; i++) fSumSq += filtered[i] * filtered[i];
      if (Math.sqrt(fSumSq / frameSize) >= frameThreshold) activeFrames++;
    }
    const activeRatio = totalFrames > 0 ? activeFrames / totalFrames : 0;

    // ── 5단계: 복합 판정 (전체 RMS AND 활성 비율 — 둘 다 통과해야 발화) ─
    const rmsPass = overallRms >= speechThreshold;
    const ratioPass = activeRatio >= vadState.ACTIVE_RATIO_MIN;
    const isSpeech = rmsPass && ratioPass;

    // ── 6단계: 침묵 구간에서 노이즈 플로어 학습 (적응) ──────────────
    if (!isSpeech) {
      vadState.noiseFloor =
        vadState.noiseFloor * (1 - vadState.LEARN_RATE) +
        overallRms * vadState.LEARN_RATE;
    }

    console.log(
      `[VAD] rms=${overallRms.toFixed(4)} thr=${speechThreshold.toFixed(4)} ` +
      `active=${(activeRatio * 100).toFixed(0)}% floor=${vadState.noiseFloor.toFixed(4)} ` +
      `→ ${isSpeech ? '✅SPEECH' : '🔇SILENCE'}`,
    );
    return isSpeech;
  } catch {
    // 디코딩 실패 시 통과 (실제 발화를 잘못 차단하는 것이 더 위험)
    return true;
  }
}

// ─────────────────────────────────────────────
// Gemini 기반 STT (Web Speech API 대체)
// MediaRecorder로 오디오 캡처 → Gemini 전사 → 번역 파이프라인 연결
// ─────────────────────────────────────────────
export class GeminiSTTManager {
  private isRunning = false;
  private micRecorder: MediaRecorder | null = null;
  private sysRecorder: MediaRecorder | null = null;
  private micTimer: ReturnType<typeof setTimeout> | null = null;
  private sysTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly CHUNK_MS = 1500; // 1.5초마다 전사 (3초→1.5초 지연 절감)

  constructor(
    private readonly micStream: MediaStream | null,
    private readonly sysStream: MediaStream | null,
    private readonly micLang: STTLanguage,
    private readonly sysLang: STTLanguage,
    private readonly apiKey: string,
    private readonly onMicFinal: (text: string) => void,
    private readonly onSysFinal: (text: string) => void,
    private readonly onMicInterim?: (text: string) => void,
    private readonly onSysInterim?: (text: string) => void,
    private readonly onError?: (source: 'mic' | 'sys', error: string) => void
  ) {}

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    if (this.micStream) this.scheduleCapture('mic');
    if (this.sysStream) this.scheduleCapture('sys');
  }

  private scheduleCapture(source: 'mic' | 'sys'): void {
    if (!this.isRunning) return;
    const stream = source === 'mic' ? this.micStream : this.sysStream;
    if (!stream) return;

    // 스트림 트랙이 살아있는지 확인 — 만료 시 3초 후 재시도
    const activeTracks = stream.getAudioTracks().filter((t) => t.readyState === 'live');
    if (activeTracks.length === 0) {
      console.warn(`[GeminiSTT] ${source} 스트림 만료 — 3초 후 재시도`);
      setTimeout(() => this.scheduleCapture(source), 3000);
      return;
    }

    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
      console.warn(`[GeminiSTT] ${source} MediaRecorder 생성 실패:`, e);
      return;
    }

    recorder.onerror = (e) => {
      console.error(`[GeminiSTT] ${source} MediaRecorder 오류:`, e);
    };

    if (source === 'mic') this.micRecorder = recorder;
    else this.sysRecorder = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      if (!this.isRunning) return;

      // ── 빈 청크 감지: 마이크 장치가 무음(또는 잘못된 장치)인 경우 ──
      if (chunks.length === 0) {
        console.warn(
          `[GeminiSTT] ${source} 오디오 데이터 없음 — ` +
          `"내 마이크 입력"에서 실제 마이크를 선택했는지 확인해 주세요. ` +
          `(기본 장치가 TalkSync Virtual Audio Cable일 수 있습니다)`
        );
        if (source === 'mic') this.onMicInterim?.(''); // 인식 중... 클리어
        else this.onSysInterim?.(''); // sys 인식 중... 클리어
        if (this.isRunning) this.scheduleCapture(source);
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      try {
        const arrayBuffer = await blob.arrayBuffer();

        // ── VAD 사전 검사: 목소리 없는 청크는 API 호출 차단 ──
        const hasSpeech = await analyzeVAD(arrayBuffer);
        if (!hasSpeech) {
          if (source === 'mic') this.onMicInterim?.(''); // 침묵 → 인식 중... 클리어
          else this.onSysInterim?.(''); // 침묵 → sys 인식 중... 클리어
          if (this.isRunning) this.scheduleCapture(source);
          return;
        }

        // VAD 통과 → 이제 실제 API 전송 중임을 표시
        if (source === 'mic') this.onMicInterim?.('인식 중...');
        else this.onSysInterim?.('인식 중...');
        console.log(`[GeminiSTT] ${source} VAD 통과 → API 전송`);

        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const lang = source === 'mic' ? this.micLang : this.sysLang;
        const text = await transcribeAudio(base64, mimeType.split(';')[0], lang, this.apiKey);
        const cleaned = text.trim();
        // 타임스탬프·숫자만 응답(예: "0시0분0초", "0:00:00") 무시
        if (cleaned && !/^[\d시분초:\s,.]+$/.test(cleaned)) {
          if (source === 'mic') this.onMicFinal(cleaned);
          else this.onSysFinal(cleaned);
        }
      } catch (e) {
        console.warn(`[GeminiSTT] ${source} 전사 실패:`, e);
      }
      // 다음 청크 시작
      if (this.isRunning) this.scheduleCapture(source);
    };

    try {
      recorder.start();
    } catch (e) {
      console.error(`[GeminiSTT] ${source} recorder.start() 실패:`, e);
      return;
    }
    // "인식 중..." 표시는 VAD 통과 후에만 — 무음 루프 때 고착 방지

    const timer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, this.CHUNK_MS);

    if (source === 'mic') this.micTimer = timer;
    else this.sysTimer = timer;
  }

  stop(): void {
    this.isRunning = false;
    if (this.micTimer) { clearTimeout(this.micTimer); this.micTimer = null; }
    if (this.sysTimer) { clearTimeout(this.sysTimer); this.sysTimer = null; }
    [this.micRecorder, this.sysRecorder].forEach((r) => {
      if (r?.state === 'recording') { try { r.stop(); } catch { /* ignore */ } }
    });
    this.micRecorder = null;
    this.sysRecorder = null;
  }

  get running(): boolean { return this.isRunning; }
}

export const SUPPORTED_LANGUAGES: { code: STTLanguage; label: string; flag: string }[] = [
  { code: 'ko-KR', label: '한국어', flag: '🇰🇷' },
  { code: 'en-US', label: 'English (US)', flag: '🇺🇸' },
  { code: 'en-GB', label: 'English (UK)', flag: '🇬🇧' },
  { code: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { code: 'zh-CN', label: '中文 (简体)', flag: '🇨🇳' },
  { code: 'zh-TW', label: '中文 (繁體)', flag: '🇹🇼' },
  { code: 'es-ES', label: 'Español', flag: '🇪🇸' },
  { code: 'fr-FR', label: 'Français', flag: '🇫🇷' },
  { code: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'vi-VN', label: 'Tiếng Việt', flag: '🇻🇳' },
];
