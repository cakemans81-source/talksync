'use client';

/**
 * useAutoAudioSetup — Two-Track Zero-Configuration 오디오 자동 바인딩 훅
 *
 * 감지 전략:
 *   [물리 마이크]        audioinput  중 non-virtual 첫 번째
 *   [TalkSync input]    audioinput  중 TalkSync Microphone/Tx label 우선
 *   [이어폰 출력]        audiooutput 중 non-virtual (시스템 기본)
 *   [TalkSync output]   audiooutput 중 TalkSync Speaker/Rx label 우선
 *
 * TalkSync 전용 label이 명확한 경우만 ready로 처리한다.
 * legacy/generic virtual cable은 manual-review 상태로 남긴다.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  isPhysicalInputDevice,
  isPhysicalOutputDevice,
  isVirtualAudioDevice,
  selectAutoAudioDevices,
  type VirtualBindingMode,
} from '@/lib/audioDeviceBinding';

function cleanLabel(label: string, fallback: string) {
  return label.replace(/\s*\(.*?\)\s*/g, '').trim() || fallback;
}

export type AutoAudioState = 'scanning' | 'ready' | 'manual-review' | 'no-cable' | 'error';

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
  bindingMode: VirtualBindingMode;
  warnings: string[];
  hasVirtualRoute: boolean;
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
  const [bindingMode, setBindingMode] = useState<VirtualBindingMode>('missing');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hasVirtualRoute, setHasVirtualRoute] = useState(false);
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

      const virtualSelection = selectAutoAudioDevices(inputs, outputs);
      const virtualInput = virtualSelection.virtualInput;
      const virtualOutput = virtualSelection.virtualOutput;
      const hasRouteCandidate = Boolean(virtualInput && virtualOutput);

      setBindingMode(virtualSelection.mode);
      setWarnings(virtualSelection.warnings);
      setHasVirtualRoute(hasRouteCandidate);

      if (!virtualInput || !virtualOutput) {
        setState('no-cable');
        return;
      }

      // ── 물리 마이크 — non-virtual audioinput ─────────────────────────
      const physMic = inputs.find(isPhysicalInputDevice)
        ?? inputs.find((d) => d.deviceId === 'default')
        ?? inputs[0];

      // ── 이어폰 — non-virtual audiooutput, 실제 device ID 우선 (default alias 제외) ─
      const physSpeaker = outputs.find(isPhysicalOutputDevice)
        ?? outputs.find((d) => !isVirtualAudioDevice(d));

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
      setState(virtualSelection.mode === 'exact-talksync' ? 'ready' : 'manual-review');
    } catch {
      setBindingMode('missing');
      setWarnings(['오디오 장치 스캔 중 오류가 발생했습니다.']);
      setHasVirtualRoute(false);
      setState('error');
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => { void scan(); }, 0);
    return () => window.clearTimeout(id);
  }, [scan, tick]);

  const rescan = useCallback(() => setTick((n) => n + 1), []);

  return {
    state,
    micId,
    virtualSpeakerId,
    earphoneId,
    virtualMicId,
    labels,
    bindingMode,
    warnings,
    hasVirtualRoute,
    rescan,
  };
}
