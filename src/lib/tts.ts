'use client';

// ─────────────────────────────────────────────
// TTS — Microsoft Edge TTS (Azure Neural)
// WebSocket 방식 — API 키 불필요, 무제한 사용
// 출력: MP3 (audio-24khz-48kbitrate-mono-mp3)
// ─────────────────────────────────────────────

export type TTSVoicePreset = {
  id: string;      // Edge TTS voice name (SSML 파라미터)
  label: string;   // UI 표시 이름
  gender: 'female' | 'male';
};

// Edge TTS Neural 보이스 프리셋
export const TTS_VOICE_PRESETS: TTSVoicePreset[] = [
  { id: 'ko-KR-SunHiNeural',    label: '한국어 여성 — SunHi',    gender: 'female' },
  { id: 'ko-KR-InJoonNeural',   label: '한국어 남성 — InJoon',   gender: 'male'   },
  { id: 'en-US-JennyNeural',    label: '영어 여성 — Jenny',      gender: 'female' },
  { id: 'en-US-GuyNeural',      label: '영어 남성 — Guy',        gender: 'male'   },
  { id: 'ja-JP-NanamiNeural',   label: '일본어 여성 — Nanami',   gender: 'female' },
  { id: 'ja-JP-KeitaNeural',    label: '일본어 남성 — Keita',    gender: 'male'   },
  { id: 'zh-CN-XiaoxiaoNeural', label: '중국어 여성 — Xiaoxiao', gender: 'female' },
  { id: 'zh-CN-YunxiNeural',    label: '중국어 남성 — Yunxi',    gender: 'male'   },
  { id: 'fr-FR-DeniseNeural',   label: '프랑스어 여성 — Denise', gender: 'female' },
  { id: 'de-DE-KatjaNeural',    label: '독일어 여성 — Katja',    gender: 'female' },
  { id: 'es-ES-ElviraNeural',   label: '스페인어 여성 — Elvira', gender: 'female' },
  { id: 'vi-VN-HoaiMyNeural',   label: '베트남어 여성 — HoaiMy', gender: 'female' },
];

// 언어 코드 → Edge TTS 기본 보이스
export function defaultEdgeVoiceForLang(langCode: string): string {
  const map: Record<string, string> = {
    'ko-KR': 'ko-KR-SunHiNeural',
    'ja-JP': 'ja-JP-NanamiNeural',
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    'zh-TW': 'zh-TW-HsiaoChenNeural',
    'en-US': 'en-US-JennyNeural',
    'en-GB': 'en-GB-SoniaNeural',
    'es-ES': 'es-ES-ElviraNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'de-DE': 'de-DE-KatjaNeural',
    'vi-VN': 'vi-VN-HoaiMyNeural',
  };
  return map[langCode] ?? 'en-US-JennyNeural';
}

// ── Edge TTS WebSocket ────────────────────────
// Microsoft Edge Read Aloud 공개 엔드포인트 사용
// Electron Chromium 렌더러에서 브라우저 네이티브 WebSocket으로 연결
const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

function uuid(): string {
  return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

// 텍스트 → MP3 ArrayBuffer (VB-Cable/이어폰 라우팅용)
// AudioContext는 호출 측(AudioRouter)에서 디코딩 — ctx 불일치 방지
export async function synthesizeEdgeTTS(
  text: string,
  voice: string,
  rate = 1.0
): Promise<ArrayBuffer | null> {
  if (!text.trim()) return null;

  return new Promise<ArrayBuffer | null>((resolve) => {
    const connId = uuid();
    const ws = new WebSocket(
      `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` +
      `?TrustedClientToken=${EDGE_TTS_TOKEN}&ConnectionId=${connId}`
    );
    ws.binaryType = 'arraybuffer';

    const chunks: ArrayBuffer[] = [];
    let settled = false;

    const done = (result: ArrayBuffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      ws.close();
      done(null);
    }, 15000);

    ws.onopen = () => {
      const ts = new Date().toISOString();

      // 1. 음성 설정 전송
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      );

      // 2. SSML 합성 요청
      const rateStr = rate >= 1
        ? `+${Math.round((rate - 1) * 100)}%`
        : `${Math.round((rate - 1) * 100)}%`;
      const lang = voice.slice(0, 5); // 'ko-KR'
      const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
        `<voice name='${voice}'><prosody rate='${rateStr}'>${escaped}</prosody></voice></speak>`;

      ws.send(
        `X-RequestId:${connId}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${ts}\r\nPath:ssml\r\n\r\n${ssml}`
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // 텍스트 메시지: turn.end 수신 시 오디오 청크 병합 후 반환
        if (event.data.includes('Path:turn.end')) {
          ws.close();
          const total = chunks.reduce((s, c) => s + c.byteLength, 0);
          const merged = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }
          done(merged.buffer);
        }
      } else if (event.data instanceof ArrayBuffer) {
        // 바이너리 메시지: [2바이트 헤더 길이][헤더][MP3 오디오 데이터]
        const headerLen = new DataView(event.data).getUint16(0);
        const audioData = event.data.slice(2 + headerLen);
        if (audioData.byteLength > 0) chunks.push(audioData);
      }
    };

    ws.onerror = () => done(null);
    ws.onclose = () => { /* done()은 이미 호출됨 */ };
  });
}

// ── TTS 중단 (브라우저 TTS 폴백용) ────────────
export function stopTTS(): void {
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

// ── 브라우저 내장 TTS (Edge TTS 실패 시 폴백) ──
export function speakBrowserTTS(text: string, langCode: string, rate = 1.0): void {
  if (!text.trim() || typeof window === 'undefined') return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = langCode;
  utterance.rate = rate;
  synth.speak(utterance);
}

// ─────────────────────────────────────────────
// TTS 엔진 타입
// ─────────────────────────────────────────────
export type TTSEngine = 'edge' | 'elevenlabs' | 'gemini';

// ── ElevenLabs TTS ────────────────────────────
// eleven_multilingual_v2 모델 — 다국어 자동 지원, API 키 필요

// GET /v1/voices 응답 타입 (필요한 필드만)
export type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category: string; // 'premade' | 'cloned' | 'generated' | ...
  preview_url?: string; // 미리 듣기 MP3 URL (ElevenLabs CDN)
  labels: Partial<{
    accent: string;
    description: string;
    age: string;
    gender: string;
    use_case: string;
  }>;
};

// voice 메타데이터 → UI 라벨 조합 (최대 3개 태그)
export function buildElevenLabsLabel(v: ElevenLabsVoice): string {
  const tags = [v.labels.accent, v.labels.use_case, v.labels.description]
    .filter(Boolean)
    .map((s) => s!.charAt(0).toUpperCase() + s!.slice(1))
    .join(' · ');
  return tags ? `${v.name} — ${tags}` : v.name;
}

// GET https://api.elevenlabs.io/v1/voices
// API 키가 틀렸거나 네트워크 오류 시 throw — 호출 측에서 catch 후 폴백
export async function fetchElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs 인증 실패 (${res.status}): ${body.slice(0, 80)}`);
  }
  const data = await res.json();
  // voices 배열을 name 기준으로 오름차순 정렬
  return (data.voices as ElevenLabsVoice[]).sort((a, b) => a.name.localeCompare(b.name));
}

// 하드코딩 폴백 프리셋 — API 패치 실패 시 렌더링
export const ELEVENLABS_VOICE_PRESETS: { id: string; label: string }[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel — American · Narration · Calm' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam — American · Narration · Deep'   },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella — American · Narration · Soft'  },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni — American · Narration · Well-rounded' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold — American · Narration · Crisp' },
  { id: 'ThT5KcBeYPX3keUQqHPh', label: 'Dorothy — British · Narration · Pleasant' },
];

export async function synthesizeElevenLabsTTS(
  text: string,
  voiceId: string,
  apiKey: string
): Promise<ArrayBuffer | null> {
  if (!text.trim()) return null;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.arrayBuffer();
}

// ── Gemini TTS ────────────────────────────────
// gemini-2.5-flash-preview-tts — API 키 필요, 다국어 지원
// PCM LINEAR16(24kHz) 반환 → WAV 컨테이너로 래핑하여 AudioContext에서 디코딩
export const GEMINI_TTS_VOICE_PRESETS = [
  { id: 'Aoede',  label: 'Aoede — 여성, 밝음'  },
  { id: 'Puck',   label: 'Puck — 남성, 활기참' },
  { id: 'Charon', label: 'Charon — 남성, 중후함' },
  { id: 'Kore',   label: 'Kore — 여성, 차분'   },
  { id: 'Fenrir', label: 'Fenrir — 남성, 강렬함' },
  { id: 'Leda',   label: 'Leda — 여성, 부드러움' },
  { id: 'Orus',   label: 'Orus — 남성, 안정적'  },
  { id: 'Zephyr', label: 'Zephyr — 중성, 자연스러움' },
];

// PCM LINEAR16 raw bytes → WAV file ArrayBuffer
function pcmToWav(pcm: ArrayBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): ArrayBuffer {
  const data = new Uint8Array(pcm);
  const wav = new ArrayBuffer(44 + data.byteLength);
  const v = new DataView(wav);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0,  'RIFF');
  v.setUint32(4,  36 + data.byteLength, true);
  str(8,  'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1,  true);                                         // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bitsPerSample / 8, true);  // ByteRate
  v.setUint16(32, channels * bitsPerSample / 8, true);               // BlockAlign
  v.setUint16(34, bitsPerSample, true);
  str(36, 'data');
  v.setUint32(40, data.byteLength, true);
  new Uint8Array(wav, 44).set(data);
  return wav;
}

export async function synthesizeGeminiTTS(
  text: string,
  voice: string,
  apiKey: string
): Promise<ArrayBuffer | null> {
  if (!text.trim()) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1alpha/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini TTS ${res.status}: ${body.slice(0, 120)}`);
  }

  const json = await res.json();
  const b64: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error('Gemini TTS: 오디오 데이터 없음');

  const binary = atob(b64);
  const pcm = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pcm[i] = binary.charCodeAt(i);
  return pcmToWav(pcm.buffer);
}
