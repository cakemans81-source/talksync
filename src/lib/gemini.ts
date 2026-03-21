'use client';

import { GoogleGenerativeAI } from '@google/generative-ai';

// ─────────────────────────────────────────────
// Gemini 1.5 Flash — 클라이언트 직접 호출 (BYOK)
// 평균 응답: ~400ms → 전체 파이프라인 딜레이 <2s
// ─────────────────────────────────────────────

const PROMPT = (from: string, to: string, text: string) => `
You are a real-time speech interpreter. Translate the following ${from} speech to ${to}.

Rules:
- Return ONLY the translated text
- Preserve natural spoken language (not formal/written style)
- Keep it concise — this will be converted to speech immediately
- Do not add any explanation, punctuation changes, or comments

Text: "${text}"
`.trim();

function getModel(apiKey: string) {
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    generationConfig: { maxOutputTokens: 256, temperature: 0.2 },
  });
}

// ── 단순 번역 ────────────────────────────────
export async function translateText(
  text: string, fromLang: string, toLang: string, apiKey: string
): Promise<string> {
  if (!text.trim()) return '';
  const result = await getModel(apiKey).generateContent(PROMPT(fromLang, toLang, text));
  return result.response.text().trim();
}

// ── 스트리밍 번역 (자막 실시간 표시) ────────
// 청크 단위로 번역 결과를 받아 자막을 즉시 업데이트
// TTS는 최종 완성본으로 실행
export async function* translateTextStream(
  text: string, fromLang: string, toLang: string, apiKey: string
): AsyncGenerator<string> {
  if (!text.trim()) return;
  const result = await getModel(apiKey).generateContentStream(PROMPT(fromLang, toLang, text));
  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) yield t;
  }
}

// ── API 키 유효성 검증 ────────────────────────
export async function validateGeminiKey(apiKey: string): Promise<boolean> {
  try {
    await getModel(apiKey).generateContent({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
    return true;
  } catch { return false; }
}

// ── 오디오 전사 (STT 대체용) ──────────────────
// Web Speech API 대신 Gemini로 오디오 → 텍스트 변환
export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  langCode: string,
  apiKey: string
): Promise<string> {
  if (!base64Audio) return '';
  const langName = langCodeToName(langCode);
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    generationConfig: { maxOutputTokens: 512, temperature: 0 },
  });
  const result = await model.generateContent([
    { inlineData: { mimeType, data: base64Audio } },
    { text: `You are a strict speech-to-text transcriber. Your ONLY job is to write down exactly what a real human voice says in this audio.

ABSOLUTE RULES — violating any of these is forbidden:
1. If you hear NO clear human speech (silence, background noise, music, static, hiss, hum, keyboard sounds, etc.), you MUST return the single word: EMPTY
2. NEVER invent, guess, or hallucinate any words that were not actually spoken
3. NEVER return system messages, status phrases, or filler text such as "Recognizing now", "인식 중", "소리를 인식해", "인식하고 있어요", or anything similar
4. NEVER include timestamps, time codes [00:00], speaker labels, or markdown
5. NEVER include descriptions like [silence], [noise], [applause], (music), etc.
6. Return ONLY the verbatim spoken words in ${langName}
7. If you are even slightly unsure whether a real human voice is present, return: EMPTY

Output format: plain transcribed text only, or the single word EMPTY` },
  ]);
  const raw = result.response.text().trim();

  // 빈 응답 또는 EMPTY 마커
  if (!raw || raw === 'EMPTY') return '';

  // 환각 패턴 필터: 숫자·기호만, 또는 알려진 시스템 문구 차단
  if (/^[\d:,\.\s\[\]()\-–]+$/.test(raw)) return '';
  const hallucinationPatterns = [
    /recogni[sz]ing/i, /인식\s*(중|하고|해|됩니다)/i,
    /소리를\s*인식/i, /transcrib/i, /no\s*speech/i,
    /silence/i, /침묵/i, /잡음/i, /background\s*noise/i,
  ];
  if (hallucinationPatterns.some((p) => p.test(raw))) return '';

  return raw;
}

// ── Gemini TTS (gemini-2.5-flash-preview-tts) ─
// PCM LINEAR16 (24kHz, mono) ArrayBuffer 반환
export async function synthesizeSpeech(
  text: string,
  langCode: string,
  apiKey: string
): Promise<ArrayBuffer | null> {
  if (!text.trim()) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-preview-tts',
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: ttsVoiceForLang(langCode) },
        },
      },
    } as unknown as import('@google/generative-ai').GenerationConfig,
  });

  const result = await model.generateContent(text);
  const part = result.response.candidates?.[0]?.content?.parts?.[0] as
    | { inlineData?: { data: string; mimeType: string } }
    | undefined;
  if (!part?.inlineData?.data) return null;

  const binaryStr = atob(part.inlineData.data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes.buffer;
}

function ttsVoiceForLang(langCode: string): string {
  const map: Record<string, string> = {
    'ko-KR': 'Kore',
    'ja-JP': 'Kore',
    'zh-CN': 'Charon',
    'zh-TW': 'Charon',
    'en-US': 'Aoede',
    'en-GB': 'Aoede',
    'es-ES': 'Fenrir',
    'fr-FR': 'Zephyr',
    'de-DE': 'Puck',
    'vi-VN': 'Aoede',
  };
  return map[langCode] ?? 'Aoede';
}

// ── 언어 코드 → Gemini 프롬프트용 언어명 ─────
export function langCodeToName(code: string): string {
  const map: Record<string, string> = {
    'ko-KR': 'Korean', 'en-US': 'English', 'en-GB': 'English',
    'ja-JP': 'Japanese', 'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)', 'es-ES': 'Spanish',
    'fr-FR': 'French', 'de-DE': 'German', 'vi-VN': 'Vietnamese',
  };
  return map[code] ?? code;
}
