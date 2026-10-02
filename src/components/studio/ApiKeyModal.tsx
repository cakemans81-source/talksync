'use client';

import { useState } from 'react';
import { validateGeminiKey } from '@/lib/gemini';
import { encryptApiKey, cacheApiKeyInSession, saveKeyLocally } from '@/lib/crypto';
import { getCurrentUser, saveEncryptedKey } from '@/lib/supabase';

// ── API 키 설정 모달 ──────────────────────────
export function ApiKeyModal({
  userId, hasExistingKey, onUserResolved, onSave, onClose,
}: {
  userId: string | null;
  hasExistingKey: boolean;
  onUserResolved: (userId: string) => void;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState('');

  async function handleValidate() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError('');
    try {
      const valid = await validateGeminiKey(apiKey.trim());
      if (!valid) throw new Error('유효하지 않은 키입니다. Google AI Studio에서 다시 확인해주세요.');
      setValidated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '검증 실패');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setLoading(true);
    try {
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        const user = await getCurrentUser();
        if (!user) throw new Error('로그인 상태를 확인할 수 없습니다. 다시 로그인한 뒤 API 키를 저장해 주세요.');
        resolvedUserId = user.id;
        onUserResolved(user.id);
      }

      const encrypted = await encryptApiKey(apiKey.trim(), resolvedUserId);

      // 로컬 저장 먼저 — Supabase가 실패해도 다음 로그인 시 복원 가능
      saveKeyLocally(encrypted, resolvedUserId);
      cacheApiKeyInSession(apiKey.trim());

      // Supabase 저장 (실패해도 로컬에 있으므로 앱 동작엔 영향 없음)
      try {
        await saveEncryptedKey(resolvedUserId, encrypted);
      } catch { /* Supabase 저장 실패 — 로컬에 저장됐으므로 계속 진행 */ }

      onSave(apiKey.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[220] flex items-center justify-center p-4">
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 border border-zinc-100">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="API 키 설정 닫기"
          className="absolute right-5 top-5 w-8 h-8 rounded-full border border-zinc-200 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
        >
          ×
        </button>

        {/* 헤더 */}
        <div className="flex items-start gap-4 mb-7">
          <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xl">🔑</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Gemini API 키 설정</h2>
            <p className="text-sm text-zinc-400 mt-0.5">통역에 사용할 API 키를 입력해주세요</p>
          </div>
        </div>

        {hasExistingKey && (
          <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700">
            저장된 Gemini API 키가 있습니다. 새 키를 저장하면 기존 키가 교체됩니다.
          </div>
        )}

        {/* API 가이드 */}
        <div className="bg-zinc-50 rounded-2xl p-4 mb-6 border border-zinc-100">
          <p className="text-xs font-medium text-zinc-700 mb-3">[1분 완성] 무료 API 키 발급</p>
          <div className="space-y-2">
            {[
              { n: '1', text: 'aistudio.google.com 접속 →', link: 'https://aistudio.google.com/app/apikey' },
              { n: '2', text: '"Create API key" 클릭' },
              { n: '3', text: '"AIza..."로 시작하는 키 복사 후 아래 입력' },
            ].map(({ n, text, link }) => (
              <div key={n} className="flex items-center gap-2.5">
                <span className="w-5 h-5 bg-zinc-900 text-white text-xs rounded-full flex items-center justify-center flex-shrink-0 font-bold">{n}</span>
                {link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline">{text}</a>
                ) : (
                  <span className="text-xs text-zinc-600">{text}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">{error}</div>
        )}

        {/* 입력 */}
        <div className="relative mb-4">
          <input
            type="text"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setValidated(false); setError(''); }}
            placeholder="AIzaSy..."
            className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-mono text-zinc-900 placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 focus:border-zinc-400 transition pr-20"
          />
          {validated && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs bg-green-50 text-green-600 font-medium px-2 py-1 rounded-lg border border-green-100">
              ✓ 유효
            </span>
          )}
        </div>

        {/* 버튼 */}
        {!validated ? (
          <button
            onClick={handleValidate}
            disabled={loading || !apiKey.trim()}
            className="w-full py-3 border-2 border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white disabled:border-zinc-200 disabled:text-zinc-300 font-medium rounded-2xl transition-colors text-sm"
          >
            {loading ? '확인 중...' : '키 유효성 확인'}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-700 disabled:bg-zinc-300 text-white font-medium rounded-2xl transition-colors text-sm shadow-lg shadow-zinc-900/20"
          >
            {loading ? '저장 중...' : '저장하고 통역 시작하기 →'}
          </button>
        )}

        <p className="text-center text-xs text-zinc-300 mt-4">
          🔒 키는 AES-256으로 암호화 저장됩니다
        </p>
      </div>
    </div>
  );
}
