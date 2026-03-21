'use client';

import { type AudioDevice } from '@/hooks/useAudioRouter';

type Props = {
  label: string;
  devices: AudioDevice[];
  value: string;
  onChange: (deviceId: string) => void;
  hint?: string;
  requiresCable?: boolean;
};

export function DeviceSelector({ label, devices, value, onChange, hint, requiresCable }: Props) {
  const cableDetected = devices.some((d) =>
    d.label.toLowerCase().includes('cable')
  );
  const showCableGuide = requiresCable && !cableDetected;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-zinc-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 focus:border-zinc-400 transition"
      >
        <option value="default">기본 장치</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
      {showCableGuide && (
        <div className="mt-1 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <span className="text-amber-500 text-sm mt-0.5">⚠</span>
          <div className="text-xs text-amber-700 leading-relaxed">
            <p className="font-medium mb-0.5">VB-CABLE 미설치</p>
            <p>Discord/Teams 마이크 연결에 필요해요.</p>
            <a
              href="https://vb-audio.com/Cable/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 text-amber-800 font-medium underline underline-offset-2 hover:text-amber-900"
            >
              무료 설치하기 →
            </a>
            <span className="text-amber-400 ml-2">(설치 후 PC 재시작)</span>
          </div>
        </div>
      )}
    </div>
  );
}
