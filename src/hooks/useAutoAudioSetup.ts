'use client';

/**
 * useAutoAudioSetup — Zero-Configuration 오디오 자동 바인딩 훅
 *
 * 동작 순서:
 *   1. getUserMedia()로 마이크 권한 획득 → 장치 라벨이 노출됨
 *   2. enumerateDevices()로 전체 장치 스캔
 *   3. 라벨 매칭으로 CABLE Output(mic 입력) / CABLE Input(가상 마이크 출력) 자동 선택
 *   4. 이어폰은 OS 기본 출력(default)으로 설정
 */

import { useState, useEffect, useCallback } from 'react';

// VB-CABLE / BlackHole / VoiceMeeter 등 가상 오디오 드라이버 키워드
const VIRTUAL_KEYWORDS = ['cable', 'virtual', 'blackhole', 'voicemeeter', 'soundflower', 'vb-audio'];

function isVirtual(label: string) {
  const l = label.toLowerCase();
  return VIRTUAL_KEYWORDS.some((kw) => l.includes(kw));
}

export type AutoAudioState =
  | 'scanning'   // 장치 스캔 중
  | 'ready'      // 자동 설정 완료
  | 'no-cable'   // 가상 케이블 없음
  | 'error';     // 권한 오류 등

export type AutoAudioResult = {
  state: AutoAudioState;
  /** CABLE Output deviceId → mic 입력 (audioinput) */
  micId: string;
  /** CABLE Input deviceId → 가상 마이크 출력 (audiooutput) */
  virtualMicId: string;
  /** 기본 스피커 deviceId → 이어폰 출력 */
  earphoneId: string;
  /** 감지된 장치 라벨 (UI 표시용) */
  labels: {
    mic: string;
    virtualMic: string;
    earphone: string;
  };
  /** 수동으로 재스캔 트리거 */
  rescan: () => void;
};

export function useAutoAudioSetup(): AutoAudioResult {
  const [state, setState] = useState<AutoAudioState>('scanning');
  const [micId, setMicId] = useState('default');
  const [virtualMicId, setVirtualMicId] = useState('default');
  const [earphoneId, setEarphoneId] = useState('default');
  const [labels, setLabels] = useState({ mic: '', virtualMic: '', earphone: '시스템 기본 출력' });
  const [tick, setTick] = useState(0);

  const scan = useCallback(async () => {
    setState('scanning');
    try {
      // 마이크 권한 요청 → 라벨 노출
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { /* 이미 허용 또는 불가 — 계속 진행 */ }

      const devices = await navigator.mediaDevices.enumerateDevices();

      const inputs  = devices.filter((d) => d.kind === 'audioinput');
      const outputs = devices.filter((d) => d.kind === 'audiooutput');

      // CABLE Output → mic 입력 (audioinput 중 virtual 키워드 + "output" 포함)
      const cableOutput = inputs.find((d) => {
        const l = d.label.toLowerCase();
        return isVirtual(l) && (l.includes('output') || l.includes('cable output'));
      }) ?? inputs.find((d) => isVirtual(d.label)); // "output" 없어도 virtual이면 채택

      // CABLE Input → 가상 마이크 출력 (audiooutput 중 virtual 키워드 + "input" 포함)
      const cableInput = outputs.find((d) => {
        const l = d.label.toLowerCase();
        return isVirtual(l) && (l.includes('input') || l.includes('cable input'));
      }) ?? outputs.find((d) => isVirtual(d.label));

      if (!cableOutput || !cableInput) {
        setState('no-cable');
        return;
      }

      // 기본 스피커: 'default' ID 또는 첫 번째 non-virtual 출력
      const defaultSpeaker = outputs.find((d) => d.deviceId === 'default')
        ?? outputs.find((d) => !isVirtual(d.label));
      const earId = defaultSpeaker?.deviceId ?? 'default';
      const earLabel = defaultSpeaker?.label
        ? defaultSpeaker.label.replace(/\s*\(.*?\)\s*/g, '').trim() || '시스템 기본 출력'
        : '시스템 기본 출력';

      setMicId(cableOutput.deviceId);
      setVirtualMicId(cableInput.deviceId);
      setEarphoneId(earId);
      setLabels({
        mic:        cableOutput.label || 'CABLE Output',
        virtualMic: cableInput.label  || 'CABLE Input',
        earphone:   earLabel,
      });
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan, tick]);

  const rescan = useCallback(() => setTick((n) => n + 1), []);

  return { state, micId, virtualMicId, earphoneId, labels, rescan };
}
