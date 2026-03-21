'use client';

// ─────────────────────────────────────────────
// API 키 암호화 / 복호화 — Google OAuth 전용
//
// Google OAuth 사용 시 비밀번호가 없으므로
// Supabase user.id (UUID)를 암호화 키 재료로 사용
//
// 보안 모델:
//   - DB에는 암호화된 데이터만 저장
//   - 복호화하려면 인증된 user.id가 필요
//   - 운영자 또는 DB 유출 시에도 user.id 없으면 복호화 불가
//
// 알고리즘: PBKDF2(user.id) → AES-256-GCM
// ─────────────────────────────────────────────

const SALT = 'talksync-v2-oauth-salt';
const ITERATIONS = 100_000;

async function deriveKey(userId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(userId), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── 암호화: API 키 + userId → Base64 ─────────
export async function encryptApiKey(apiKey: string, userId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await deriveKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(apiKey)
  );
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

// ── 복호화: Base64 + userId → API 키 ─────────
export async function decryptApiKey(encryptedBase64: string, userId: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await deriveKey(userId);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ── 세션 캐시 (페이지 리로드 시 초기화) ──────
const SESSION_KEY = 'ts_gemini_key';
export function cacheApiKeyInSession(apiKey: string): void {
  sessionStorage.setItem(SESSION_KEY, apiKey);
}
export function getCachedApiKey(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}
export function clearCachedApiKey(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

// ── 로컬 영구 저장 (앱 재시작 후에도 유지) ───
// 암호화된 키 + userId를 localStorage에 저장 → 매번 API 키 재입력 불필요
const LOCAL_ENC_KEY = 'ts_gemini_enc';
const LOCAL_UID_KEY = 'ts_gemini_uid';

export function saveKeyLocally(encryptedKey: string, userId: string): void {
  localStorage.setItem(LOCAL_ENC_KEY, encryptedKey);
  localStorage.setItem(LOCAL_UID_KEY, userId);
}

export function loadKeyLocally(): { encrypted: string; userId: string } | null {
  const encrypted = localStorage.getItem(LOCAL_ENC_KEY);
  const userId = localStorage.getItem(LOCAL_UID_KEY);
  if (!encrypted || !userId) return null;
  return { encrypted, userId };
}

export function clearLocalKey(): void {
  localStorage.removeItem(LOCAL_ENC_KEY);
  localStorage.removeItem(LOCAL_UID_KEY);
}
