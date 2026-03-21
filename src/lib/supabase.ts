import { createBrowserClient } from '@supabase/ssr';

// ─────────────────────────────────────────────
// Supabase 클라이언트 (브라우저용)
// ─────────────────────────────────────────────

export type ProfileRow = {
  id: string;
  encrypted_gemini_key: string | null;
  created_at: string;
};

export function createSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

let client: ReturnType<typeof createSupabaseClient> | null = null;
export function getSupabaseClient() {
  if (!client) client = createSupabaseClient();
  return client;
}

// ── 현재 로그인한 사용자 조회 ────────────────
export async function getCurrentUser() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ── 암호화된 API 키 저장 ─────────────────────
export async function saveEncryptedKey(userId: string, encryptedKey: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('user_keys')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ user_id: userId, encrypted_gemini_key: encryptedKey, updated_at: new Date().toISOString() } as any, { onConflict: 'user_id' });
  if (error) throw error;
}

// ── 암호화된 API 키 불러오기 ─────────────────
export async function loadEncryptedKey(userId: string): Promise<string | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_keys')
    .select('encrypted_gemini_key')
    .eq('user_id', userId)
    .single();
  if (error) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any)?.encrypted_gemini_key ?? null;
}
