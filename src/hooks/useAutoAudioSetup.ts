'use client';

/**
 * useAutoAudioSetup — Two-Track Zero-Configuration 오디오 자동 바인딩 훅
 *
 * 감지 전략:
 *   [물리 마이크]        audioinput  중 non-virtual 첫 번째
 *   [화상회의 수신]      audioinput  중 virtual (TalkSync Rx 등)
 *   [이어폰 출력]        audiooutput 중 non-virtual (시스템 기본)
 *   [화상회의 마이크]    audiooutput 중 virtual (TalkSync Tx 등)
 */

import { useState, useEffect, useCallback } from 'react';

const VIRTUAL_KEYWORDS = ['cable', 'virtual', 'blackhole', 'voicemeeter', 'soundflower', 'vb-audio'];

function isVirtual(label: string) {
  const l = label.toLowerCase();
  return VIRTUAL_KEYWORDS.some((kw) => l.includes(kw));
}

function cleanLabel(label: string, fallback: string) {
  return label.replace(/\s*\(.*?\)\s*/g, '').trim() || fallback;
}

export type AutoAudioState = 'scanning' | 'ready' | 'no-cable' | 'error';

export type AutoAudioResult = {
  state: AutoAudioState;
  /** 물리 마이크 deviceId (audioinput) */
  micId: string;
  /** 화상회의 수신용 가상 스피커 deviceId — TalkSync Rx (audioinput) */
  virtualSpeakerId: string;
  /** 이어폰 출력 deviceId (audiooutput) */
  earphoneId: string;
  /** 화상회의 마이크 송신 deviceId — TalkSync Tx (audiooutput) */
  virtualMicId: string;
  /** 감지된 장치 라벨 (UI 뱃지용) */
  labels: {
    mic: string;
    virtualSpeaker: string;
    earphone: string;
    virtualMic: string;
  };
  rescan: () => void;
};

export function useAutoAudioSetup(): AutoAudioResult {
  const [state, setState] = useState<AutoAudioState>('scanning');
  const [micId, setMicId] = useState('default');
  const [virtualSpeakerId, setVirtualSpeakerId] = useState('default');
  const [earphoneId, setEarphoneId] = useState('default');
  const [virtualMicId, setVirtualMicId] = useState('default');
  const [labels, setLabels] = useState({
    mic: '', virtualSpeaker: '', earphone: '시스템 기본 출력', virtualMic: '',
  });
  const [tick, setTick] = useState(0);

  const scan = useCallback(async () => {
    setState('scanning');
    try {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { /* 이미 허용 또는 불가 */ }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs  = devices.filter((d) => d.kind === 'audioinput');
      const outputs = devices.filter((d) => d.kind === 'audiooutput');

      // ── 화상회의 수신 — TalkSync Rx 우선, 없으면 임의 virtual audioinput ──
      // 우선순위: 1) label에 "cable-b"/"cable b" 포함  2) output 포함  3) 임의 virtual
      const isCableB = (label: string) => /cable[\s-]?b\b/i.test(label);
      const virtualInput =
        inputs.find((d) => isVirtual(d.label) && isCableB(d.label)) ??
        inputs.find((d) => isVirtual(d.label) && d.label.toLowerCase().includes('output')) ??
        inputs.find((d) => isVirtual(d.label));

      // ── 화상회의 송신 — CABLE-A Input 우선 (non-B), 없으면 임의 virtual audiooutput ──
      // 우선순위: 1) input 포함 + non-B  2) input 포함  3) 임의 virtual
      const virtualOutput =
        outputs.find((d) => isVirtual(d.label) && d.label.toLowerCase().includes('input') && !isCableB(d.label)) ??
        outputs.find((d) => isVirtual(d.label) && d.label.toLowerCase().includes('input')) ??
        outputs.find((d) => isVirtual(d.label));

      if (!virtualInput || !virtualOutput) {
        setState('no-cable');
        return;
      }

      // ── 물리 마이크 — non-virtual audioinput ─────────────────────────
      const physMic = inputs.find((d) => d.deviceId !== 'default' && !isVirtual(d.label))
        ?? inputs.find((d) => d.deviceId === 'default')
        ?? inputs[0];

      // ── 이어폰 — non-virtual audiooutput, 실제 device ID 우선 (default alias 제외) ─
      const physSpeaker = outputs.find((d) => d.deviceId !== 'default' && !isVirtual(d.label))
        ?? outputs.find((d) => !isVirtual(d.label));

      setMicId(physMic?.deviceId ?? 'default');
      setVirtualSpeakerId(virtualInput.deviceId);
      setEarphoneId(physSpeaker?.deviceId ?? 'default');
      setVirtualMicId(virtualOutput.deviceId);
      setLabels({
        mic:           cleanLabel(physMic?.label ?? '', '기본 마이크'),
        virtualSpeaker: cleanLabel(virtualInput.label, 'TalkSync Rx'),
        earphone:       cleanLabel(physSpeaker?.label ?? '', '시스템 기본 출력'),
        virtualMic:     cleanLabel(virtualOutput.label, 'TalkSync Tx'),
      });
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { scan(); }, [scan, tick]);

  const rescan = useCallback(() => setTick((n) => n + 1), []);

  return { state, micId, virtualSpeakerId, earphoneId, virtualMicId, labels, rescan };
}
