import { isVirtualAudioDevice } from '@/lib/audioDeviceBinding';

// ─────────────────────────────────────────────
// 가상 오디오 장치 감지
//
// VB-Cable (Windows) / BlackHole (macOS) / Voicemeeter / Soundflower 등
// 장치 라벨에서 가상 오디오 드라이버 키워드를 검색
// ─────────────────────────────────────────────
export async function detectVirtualAudioDevice(): Promise<boolean> {
  try {
    // 권한 없이 호출하면 라벨이 빈 문자열로 오므로 먼저 마이크 권한 요청
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* 이미 허용됐거나 불가 — 계속 진행 */ }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(isVirtualAudioDevice);
  } catch {
    return false;
  }
}
