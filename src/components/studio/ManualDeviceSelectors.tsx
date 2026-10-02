import type { AudioDevice } from '@/hooks/useAudioRouter';
import { DeviceSelector } from '@/components/audio/DeviceSelector';

// ── 수동 장치 선택 (마이크 입력 / 가상 마이크 출력 / 이어폰 출력) ──
// 'ready' 고급 설정과 'manual-review' 양쪽에서 공용
export function ManualDeviceSelectors({
  inputs, outputs,
  micDeviceId, virtualMicDeviceId, earphoneDeviceId,
  onMicChange, onVirtualMicChange, onEarphoneChange,
}: {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
  micDeviceId: string;
  virtualMicDeviceId: string;
  earphoneDeviceId: string;
  onMicChange: (id: string) => void;
  onVirtualMicChange: (id: string) => void;
  onEarphoneChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap pt-1 pl-1">
      <DeviceSelector
        label="마이크 입력"
        devices={inputs}
        value={micDeviceId}
        onChange={onMicChange}
      />
      <DeviceSelector
        label="가상 마이크 출력"
        devices={outputs}
        value={virtualMicDeviceId}
        onChange={onVirtualMicChange}
        requiresCable
      />
      <DeviceSelector
        label="이어폰 출력"
        devices={outputs}
        value={earphoneDeviceId}
        onChange={onEarphoneChange}
      />
    </div>
  );
}
