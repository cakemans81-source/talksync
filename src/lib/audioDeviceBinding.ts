export type AudioDeviceLike = {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
};

export const VIRTUAL_AUDIO_KEYWORDS = [
  'cable',
  'virtual',
  'blackhole',
  'voicemeeter',
  'soundflower',
  'vb-audio',
] as const;

export type VirtualBindingMode =
  | 'exact-talksync'
  | 'legacy-talksync'
  | 'generic-fallback'
  | 'missing';

export type AutoAudioDeviceSelection = {
  mode: VirtualBindingMode;
  virtualInput?: AudioDeviceLike;
  virtualOutput?: AudioDeviceLike;
  warnings: string[];
};

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasStandaloneToken(label: string, token: 'rx' | 'tx'): boolean {
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i').test(label);
}

export function isTalkSyncDevice(device: Pick<AudioDeviceLike, 'label'>): boolean {
  return normalizeLabel(device.label).includes('talksync');
}

export function isTalkSyncSpeakerRx(device: AudioDeviceLike): boolean {
  const label = normalizeLabel(device.label);
  return (
    device.kind === 'audiooutput' &&
    label.includes('talksync') &&
    (label.includes('speaker') || hasStandaloneToken(label, 'rx'))
  );
}

export function isTalkSyncMicrophoneTx(device: AudioDeviceLike): boolean {
  const label = normalizeLabel(device.label);
  return (
    device.kind === 'audioinput' &&
    label.includes('talksync') &&
    (label.includes('microphone') || label.includes('mic') || hasStandaloneToken(label, 'tx'))
  );
}

export function isLegacyTalkSyncVirtualCable(device: AudioDeviceLike): boolean {
  const label = normalizeLabel(device.label);
  return (
    label.includes('talksync virtual audio cable') &&
    !isTalkSyncSpeakerRx(device) &&
    !isTalkSyncMicrophoneTx(device)
  );
}

export function isGenericVirtualDevice(device: Pick<AudioDeviceLike, 'label'>): boolean {
  const label = normalizeLabel(device.label);
  return (
    !label.includes('talksync') &&
    VIRTUAL_AUDIO_KEYWORDS.some((keyword) => label.includes(keyword))
  );
}

export function isVirtualAudioDevice(device: Pick<AudioDeviceLike, 'label'>): boolean {
  return isTalkSyncDevice(device) || isGenericVirtualDevice(device);
}

export function isPhysicalOutputDevice(device: AudioDeviceLike): boolean {
  return device.kind === 'audiooutput' && device.deviceId !== 'default' && !isVirtualAudioDevice(device);
}

export function isPhysicalInputDevice(device: AudioDeviceLike): boolean {
  return device.kind === 'audioinput' && device.deviceId !== 'default' && !isVirtualAudioDevice(device);
}

export function selectAutoAudioDevices(
  inputs: AudioDeviceLike[],
  outputs: AudioDeviceLike[]
): AutoAudioDeviceSelection {
  const exactOutput = outputs.find(isTalkSyncSpeakerRx);
  const exactInput = inputs.find(isTalkSyncMicrophoneTx);

  if (exactOutput && exactInput) {
    return {
      mode: 'exact-talksync',
      virtualInput: exactInput,
      virtualOutput: exactOutput,
      warnings: [],
    };
  }

  const legacyOutput = outputs.find(isLegacyTalkSyncVirtualCable);
  const legacyInput = inputs.find(isLegacyTalkSyncVirtualCable);
  const genericOutput = outputs.find(isGenericVirtualDevice);
  const genericInput = inputs.find(isGenericVirtualDevice);

  const fallbackOutput = exactOutput ?? legacyOutput ?? genericOutput;
  const fallbackInput = exactInput ?? legacyInput ?? genericInput;

  if (fallbackOutput && fallbackInput) {
    const hasLegacy = fallbackOutput === legacyOutput || fallbackInput === legacyInput;
    const mode: VirtualBindingMode = hasLegacy ? 'legacy-talksync' : 'generic-fallback';
    return {
      mode,
      virtualInput: fallbackInput,
      virtualOutput: fallbackOutput,
      warnings: [
        mode === 'legacy-talksync'
          ? 'TalkSync legacy label만 감지되어 Tx/Rx 방향을 수동 확인해야 합니다.'
          : '일반 virtual/cable 장치가 감지되어 자동 ready 처리하지 않습니다.',
      ],
    };
  }

  return {
    mode: 'missing',
    virtualInput: fallbackInput,
    virtualOutput: fallbackOutput,
    warnings: ['TalkSync 전용 Speaker(Rx) / Microphone(Tx) 장치 쌍을 찾지 못했습니다.'],
  };
}
