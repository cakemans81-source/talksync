// ─────────────────────────────────────────────
// 유저별 앱 설정 영구 저장 모듈
//
// 저장 구조: localStorage['talksync_user_settings']
//   { [userId]: { elevenLabsApiKey?: string } }
//
// 단일 PC 멀티 계정 환경에서 유저별 설정을 안전하게 격리
// 로그아웃 시 메모리(State)는 즉시 초기화, 로컬스토리지는 보존 (다음 로그인 재사용)
// ─────────────────────────────────────────────

const STORAGE_KEY = 'talksync_user_settings';

export type UserSettings = {
  elevenLabsApiKey?: string;
};

function loadAll(): Record<string, UserSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserSettings>) : {};
  } catch {
    return {};
  }
}

/** 특정 유저의 설정 전체 반환 (존재하지 않으면 빈 객체) */
export function loadUserSettings(userId: string): UserSettings {
  return loadAll()[userId] ?? {};
}

/** 특정 유저의 설정을 부분 업데이트 (기존 키 유지, 변경 키만 덮어씀) */
export function saveUserSettings(userId: string, patch: Partial<UserSettings>): void {
  const all = loadAll();
  all[userId] = { ...all[userId], ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    console.warn('[userSettings] localStorage 저장 실패 — 용량 초과 가능성');
  }
}
