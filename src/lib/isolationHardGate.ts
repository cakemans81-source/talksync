/**
 * P0 Isolation hard-gate — full voice replacement (Live / classic peer-facing)
 * must not start unless device routing can protect the "AI voice only" claim.
 *
 * Browser Tab listen-only paths intentionally skip this gate.
 */

import {
  isPhysicalInputDevice,
  isPhysicalOutputDevice,
  isTalkSyncDevice,
  isVirtualAudioDevice,
  type AudioDeviceLike,
  type VirtualBindingMode,
} from './audioDeviceBinding';

export type IsolationScanState =
  | 'scanning'
  | 'ready'
  | 'manual-review'
  | 'no-cable'
  | 'error';

export type IsolationBlockerCode =
  | 'scanning'
  | 'scan_error'
  | 'missing_driver'
  | 'pair_not_exact'
  | 'virtual_tx_unset'
  | 'virtual_tx_missing'
  | 'virtual_tx_not_virtual'
  | 'earphone_unset'
  | 'earphone_missing'
  | 'earphone_virtual'
  | 'mic_virtual';

export type IsolationBlocker = {
  code: IsolationBlockerCode;
  message: string;
};

export type IsolationCheck = {
  id: string;
  label: string;
  pass: boolean;
};

export type IsolationHardGateInput = {
  scanState: IsolationScanState;
  bindingMode: VirtualBindingMode;
  inputs: AudioDeviceLike[];
  outputs: AudioDeviceLike[];
  micDeviceId: string;
  /** AI outbound sink (audiooutput → conference mic path) */
  virtualMicDeviceId: string;
  earphoneDeviceId: string;
};

export type IsolationHardGateResult = {
  ok: boolean;
  blockers: IsolationBlocker[];
  checks: IsolationCheck[];
  /** Short UI string for disabled button / toast */
  summary: string;
};

function findById(devices: AudioDeviceLike[], deviceId: string): AudioDeviceLike | undefined {
  if (!deviceId || deviceId === 'default') return undefined;
  return devices.find((d) => d.deviceId === deviceId);
}

function isVirtualOutput(device: AudioDeviceLike): boolean {
  return device.kind === 'audiooutput' && isVirtualAudioDevice(device);
}

function isTalkSyncVirtualOutput(device: AudioDeviceLike): boolean {
  return isVirtualOutput(device) && isTalkSyncDevice(device);
}

/**
 * Evaluate whether full voice-replacement isolation is safe to start.
 * Pure — no DOM / MediaDevices side effects.
 */
export function evaluateIsolationHardGate(
  input: IsolationHardGateInput
): IsolationHardGateResult {
  const blockers: IsolationBlocker[] = [];

  if (input.scanState === 'scanning') {
    blockers.push({
      code: 'scanning',
      message: '오디오 장치 스캔이 끝날 때까지 기다려 주세요.',
    });
  }

  if (input.scanState === 'error') {
    blockers.push({
      code: 'scan_error',
      message: '오디오 장치 스캔에 실패했습니다. 재검사 후 다시 시도해 주세요.',
    });
  }

  if (input.scanState === 'no-cable' || input.bindingMode === 'missing') {
    blockers.push({
      code: 'missing_driver',
      message:
        'TalkSync Virtual Speaker(Rx) / Microphone(Tx) 드라이버가 없습니다. 설치 후 재검사해 주세요.',
    });
  }

  const virtualMic = findById(input.outputs, input.virtualMicDeviceId);
  const earphone = findById(input.outputs, input.earphoneDeviceId);
  const mic = findById(input.inputs, input.micDeviceId);

  // Auto exact-talksync can race ahead of pipeline.device enumeration ONLY while
  // the output list is still empty. Once outputs are populated, selected ids must
  // resolve — otherwise a stale sink id can pass and leak AI audio to speakers.
  const exactPairReady =
    input.scanState === 'ready' && input.bindingMode === 'exact-talksync';
  const outputsPending = input.outputs.length === 0;
  const trustAutoExact =
    exactPairReady &&
    outputsPending &&
    Boolean(input.virtualMicDeviceId && input.virtualMicDeviceId !== 'default') &&
    Boolean(input.earphoneDeviceId && input.earphoneDeviceId !== 'default');

  // ── Outbound AI sink (virtual Tx) ─────────────────────────────
  if (!input.virtualMicDeviceId || input.virtualMicDeviceId === 'default') {
    blockers.push({
      code: 'virtual_tx_unset',
      message: '가상 마이크 출력(AI 송출) 장치를 선택해 주세요.',
    });
  } else if (virtualMic && !isVirtualOutput(virtualMic)) {
    blockers.push({
      code: 'virtual_tx_not_virtual',
      message:
        'AI 송출은 물리 스피커가 아니라 가상 오디오 출력(TalkSync Tx / Cable Input)이어야 합니다.',
    });
  } else if (!virtualMic && !trustAutoExact) {
    blockers.push({
      code: 'virtual_tx_missing',
      message: '선택한 가상 마이크 출력을 찾을 수 없습니다. 장치를 다시 선택해 주세요.',
    });
  }

  // ── Earphone (user hears AI only) ─────────────────────────────
  if (!input.earphoneDeviceId || input.earphoneDeviceId === 'default') {
    blockers.push({
      code: 'earphone_unset',
      message: '이어폰/헤드셋 출력 장치를 선택해 주세요. (시스템 기본값 불가)',
    });
  } else if (earphone && !isPhysicalOutputDevice(earphone)) {
    blockers.push({
      code: 'earphone_virtual',
      message:
        '이어폰 출력은 물리 장치여야 합니다. 가상 케이블을 이어폰으로 쓰면 원음 격리가 깨집니다.',
    });
  } else if (!earphone && !trustAutoExact) {
    blockers.push({
      code: 'earphone_missing',
      message: '선택한 이어폰 장치를 찾을 수 없습니다. 다시 선택해 주세요.',
    });
  }

  // ── Capture mic (must not be the virtual conference path) ─────
  if (mic && mic.deviceId !== 'default' && !isPhysicalInputDevice(mic) && isVirtualAudioDevice(mic)) {
    blockers.push({
      code: 'mic_virtual',
      message:
        '입력 마이크가 가상 장치입니다. 물리 마이크로 바꿔야 원음이 회의앱으로 새지 않습니다.',
    });
  }

  // ── Exact TalkSync pair (or TalkSync-labeled virtual Tx) ──────
  // System-wide exactPairReady alone is not enough once devices are listed:
  // the selected outbound sink must be TalkSync (or still enumerating).
  const selectedTalkSyncTx = virtualMic ? isTalkSyncVirtualOutput(virtualMic) : false;
  const driverAvailable =
    input.scanState !== 'no-cable' && input.bindingMode !== 'missing';
  const pairOk =
    driverAvailable && (selectedTalkSyncTx || (exactPairReady && outputsPending));

  if (
    input.scanState !== 'scanning' &&
    input.scanState !== 'error' &&
    driverAvailable &&
    !pairOk
  ) {
    blockers.push({
      code: 'pair_not_exact',
      message:
        '양방향 치환은 TalkSync Speaker(Rx)/Microphone(Tx) 전용 쌍이 필요합니다. 일반 VB-Cable만으로는 시작할 수 없습니다.',
    });
  }

  // De-dupe by code (scan may add missing_driver + pair issues)
  const seen = new Set<IsolationBlockerCode>();
  const uniqueBlockers = blockers.filter((b) => {
    if (seen.has(b.code)) return false;
    seen.add(b.code);
    return true;
  });

  const virtualTxPass = Boolean(
    (virtualMic && isVirtualOutput(virtualMic)) || (trustAutoExact && !virtualMic)
  );
  const earphonePass = Boolean(
    (earphone && isPhysicalOutputDevice(earphone)) || (trustAutoExact && !earphone)
  );

  const checks: IsolationCheck[] = [
    {
      id: 'driver_pair',
      label: 'TalkSync Rx/Tx 전용 장치 쌍',
      pass: pairOk,
    },
    {
      id: 'virtual_tx',
      label: 'AI 송출 → 가상 출력',
      pass: virtualTxPass,
    },
    {
      id: 'physical_earphone',
      label: '이어폰 → 물리 출력 (기본값 아님)',
      pass: earphonePass,
    },
    {
      id: 'physical_mic',
      label: '입력 → 물리 마이크',
      pass:
        !mic ||
        mic.deviceId === 'default' ||
        isPhysicalInputDevice(mic) ||
        !isVirtualAudioDevice(mic),
    },
  ];

  const ok = uniqueBlockers.length === 0;
  const summary = ok
    ? '원음 격리 조건 충족 — 양방향 치환을 시작할 수 있습니다.'
    : uniqueBlockers[0]?.message ?? '원음 격리 조건을 충족하지 못했습니다.';

  return { ok, blockers: uniqueBlockers, checks, summary };
}

/** First blocker message for toast / button hint */
export function isolationGateDisabledReason(result: IsolationHardGateResult): string {
  if (result.ok) return '';
  if (result.blockers.length <= 1) return result.summary;
  return `${result.summary} (외 ${result.blockers.length - 1}건)`;
}
