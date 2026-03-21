'use client';

// ─────────────────────────────────────────────
// TTS — gemini-2.5-flash-preview-tts
// 응답: Raw PCM LINEAR16 (24kHz, mono, little-endian)
// ─────────────────────────────────────────────

export type TTSOptions = {
  lang: string;   // e.g. 'en-US', 'ko-KR'
  rate?: number;  // 호환성 유지용, 미사용
  voice?: string; // Gemini TTS 보이스 이름 (미지정 시 언어 기본값)
};

// ── TTS 보이스 프리셋 ─────────────────────────
// Gemini 보이스 이름을 기준으로 브라우저 TTS 성별 매핑에도 활용
export type TTSVoicePreset = {
  id: string;             // Gemini voice name (API 파라미터)
  label: string;          // UI 표시 이름
  gender: 'female' | 'male';
};

export const TTS_VOICE_PRESETS: TTSVoicePreset[] = [
  { id: 'Aoede',  label: '여성 1 — Aoede',  gender: 'female' },
  { id: 'Zephyr', label: '여성 2 — Zephyr', gender: 'female' },
  { id: 'Kore',   label: '여성 3 — Kore',   gender: 'female' },
  { id: 'Charon', label: '남성 1 — Charon', gender: 'male'   },
  { id: 'Fenrir', label: '남성 2 — Fenrir', gender: 'male'   },
  { id: 'Puck',   label: '남성 3 — Puck',   gender: 'male'   },
];

const TTS_SAMPLE_RATE = 24000;

// AudioContext 싱글톤
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
  }
  return _audioCtx;
}

// 언어 코드 → Gemini TTS 기본 보이스 (사용자 선택 없을 때)
function defaultVoiceForLang(langCode: string): string {
  const map: Record<string, string> = {
    'ko-KR': 'Kore',   'ja-JP': 'Kore',
    'zh-CN': 'Charon', 'zh-TW': 'Charon',
    'en-US': 'Aoede',  'en-GB': 'Aoede',
    'es-ES': 'Fenrir', 'fr-FR': 'Zephyr',
    'de-DE': 'Puck',   'vi-VN': 'Aoede',
  };
  return map[langCode] ?? 'Aoede';
}

// Raw PCM Int16 (little-endian) → AudioBuffer
function pcmInt16ToAudioBuffer(base64: string): AudioBuffer {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  const ctx = getAudioCtx();
  const audioBuffer = ctx.createBuffer(1, float32.length, TTS_SAMPLE_RATE);
  audioBuffer.copyToChannel(float32, 0);
  return audioBuffer;
}

// 단일 TTS 요청 (재시도 없음)
async function callTTSApi(text: string, lang: string, key: string, voiceName?: string): Promise<AudioBuffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1alpha/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName ?? defaultVoiceForLang(lang) } },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${res.status}:${errText}`);
  }

  const json = await res.json();
  const parts: { inlineData?: { data: string; mimeType: string } }[] =
    json?.candidates?.[0]?.content?.parts ?? [];

  for (const part of parts) {
    if (part?.inlineData?.data) {
      const { data, mimeType = 'audio/pcm' } = part.inlineData;
      if (mimeType.toLowerCase().includes('pcm') || mimeType.toLowerCase().includes('l16')) {
        return pcmInt16ToAudioBuffer(data);
      }
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return await getAudioCtx().decodeAudioData(bytes.buffer.slice(0));
    }
  }
  return null;
}

// ── Gemini TTS → AudioBuffer (최대 2회 시도) ──────────────
export async function synthesizeToAudioBuffer(
  text: string,
  options: TTSOptions,
  apiKey?: string
): Promise<AudioBuffer | null> {
  const key = apiKey ?? (window as Window & { __geminiApiKey?: string }).__geminiApiKey;
  if (!key || !text.trim()) return null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const buf = await callTTSApi(text, options.lang, key, options.voice);
      return buf;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 2) {
        console.warn('[TTS] 실패 (2회):', msg);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return null;
}

// ── TTS 중단 ──────────────────────────────────
export function stopTTS(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

// ── 브라우저 TTS 보이스 성별 매핑 ──────────────
// 프리셋 gender 값을 기반으로 OS 음성 목록에서 적합한 보이스를 선택
function findBrowserVoiceByGender(langCode: string, gender: 'female' | 'male'): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const baseLang = langCode.split('-')[0].toLowerCase();
  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(baseLang));
  if (langVoices.length === 0) return undefined;

  // OS별 공통 여성/남성 음성 이름 힌트
  const femaleHints = ['female', 'woman', 'zira', 'eva', 'aria', 'jenny', 'sonia', 'samantha', 'victoria', 'kyoko', 'yuna'];
  const maleHints   = ['male', 'man', 'david', 'mark', 'george', 'ryan', 'alex', 'daniel', 'fred', 'otoya'];
  const hints = gender === 'female' ? femaleHints : maleHints;

  return (
    langVoices.find((v) => hints.some((h) => v.name.toLowerCase().includes(h))) ??
    langVoices[gender === 'female' ? 0 : Math.min(1, langVoices.length - 1)]
  );
}

// ── 브라우저 내장 TTS (Gemini 할당량 초과 시 폴백) ──────────
// voiceId: TTS_VOICE_PRESETS 의 id (Gemini voice name) — gender로 브라우저 음성 선택
// rate: 말하기 속도 (0.5~2.0, 기본 1.0)
export function speakBrowserTTS(text: string, langCode: string, voiceId?: string, rate = 1.0): void {
  if (!text.trim() || typeof window === 'undefined') return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langCode;
  utterance.rate = rate;

  if (voiceId) {
    const preset = TTS_VOICE_PRESETS.find((p) => p.id === voiceId);
    if (preset) {
      const voice = findBrowserVoiceByGender(langCode, preset.gender);
      if (voice) utterance.voice = voice;
    }
  }

  synth.speak(utterance);
}
