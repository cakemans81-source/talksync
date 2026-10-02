'use client';

import { GoogleGenerativeAI } from '@google/generative-ai';

// ─────────────────────────────────────────────
// Gemini API 키 유효성 검증 — 클라이언트 직접 호출 (BYOK)
// 경량 모델에 최소 요청('hi')을 보내 키가 동작하는지만 확인한다.
// 실시간 통역은 useGeminiLive(Live Translate WebSocket)가 담당.
// ─────────────────────────────────────────────

function getModel(apiKey: string) {
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-3.1-flash-lite-preview',
    generationConfig: { maxOutputTokens: 256, temperature: 0.2 },
  });
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
