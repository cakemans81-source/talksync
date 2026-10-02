'use client';

import { useState, type ReactNode } from 'react';
import type { AutoAudioResult } from '@/hooks/useAutoAudioSetup';
import { DeviceBadge } from './DeviceBadge';
import { VIRTUAL_AUDIO_DRIVER_URL } from './constants';
import { openExternal } from './openExternal';

// ── 오디오 자동 설정 패널 (scanning / ready / manual-review / no-cable·error) ──
// manualSelectors: <ManualDeviceSelectors /> — ready 고급 설정과 manual-review에서 공용
export function AudioSetupPanel({
  autoAudio, manualSelectors,
}: {
  autoAudio: AutoAudioResult;
  manualSelectors: ReactNode;
}) {
  const [showAdvancedDevices, setShowAdvancedDevices] = useState(false);

  return (
    <div className="flex-1">

      {/* 스캔 중 */}
      {autoAudio.state === 'scanning' && (
        <div className="flex items-center gap-2.5 py-2.5 px-4 bg-zinc-50 border border-zinc-200 rounded-2xl">
          <svg className="animate-spin w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <span className="text-sm text-zinc-500">오디오 장치 스캔 중...</span>
        </div>
      )}

      {/* 자동 설정 완료 */}
      {autoAudio.state === 'ready' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 py-2.5 px-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <span className="text-emerald-600 text-base">✅</span>
            <span className="text-sm font-medium text-emerald-700">TalkSync 전용 오디오 라우팅 자동 설정 완료</span>
            <button
              onClick={() => setShowAdvancedDevices((v) => !v)}
              className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-600 underline underline-offset-2 transition-colors"
            >
              {showAdvancedDevices ? '접기' : '고급 설정'}
            </button>
          </div>

          {/* 장치 뱃지 */}
          <div className="flex gap-2 flex-wrap px-1">
            <DeviceBadge icon="🎧" label="입력" value={autoAudio.labels.mic} />
            <DeviceBadge icon="📡" label="송출" value={autoAudio.labels.virtualMic} />
            <DeviceBadge icon="🔊" label="이어폰" value={autoAudio.labels.earphone} />
          </div>

          {/* 고급 설정 (수동 오버라이드) */}
          {showAdvancedDevices && manualSelectors}
        </div>
      )}

      {/* fallback 감지 — 자동 바인딩 금지 */}
      {autoAudio.state === 'manual-review' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2.5 py-2.5 px-4 bg-amber-50 border border-amber-200 rounded-2xl">
            <span className="text-amber-500 text-base mt-0.5">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800">가상 오디오 장치 수동 확인 필요</p>
              <p className="text-[11px] text-amber-600 mt-0.5 leading-relaxed">
                {autoAudio.bindingMode === 'legacy-talksync'
                  ? 'TalkSync legacy label은 감지됐지만 Speaker(Rx) / Microphone(Tx) 방향이 명확하지 않아요.'
                  : '일반 virtual/cable 장치는 자동 선택하지 않습니다. 아래 장치를 직접 확인해 주세요.'}
              </p>
              {autoAudio.warnings.map((warning) => (
                <p key={warning} className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                  {warning}
                </p>
              ))}
            </div>
            <button
              onClick={autoAudio.rescan}
              className="text-xs px-3 py-1.5 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors shrink-0"
            >
              재검사
            </button>
          </div>

          <div className="flex gap-2 flex-wrap px-1">
            <DeviceBadge icon="🎧" label="입력" value={autoAudio.labels.mic} />
            <DeviceBadge icon="📡" label="송출 후보" value={autoAudio.labels.virtualMic} />
            <DeviceBadge icon="🔊" label="이어폰" value={autoAudio.labels.earphone} />
          </div>

          {manualSelectors}
        </div>
      )}

      {/* 가상 케이블 없음 */}
      {(autoAudio.state === 'no-cable' || autoAudio.state === 'error') && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5 py-2.5 px-4 bg-amber-50 border border-amber-200 rounded-2xl">
            <span className="text-amber-500 text-base">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">가상 오디오 드라이버 설치가 필요합니다</p>
              <p className="text-[11px] text-amber-600 mt-0.5">Discord/Teams로 번역 음성을 전달하려면 TalkSync 가상 오디오 드라이버가 필요해요</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => openExternal(VIRTUAL_AUDIO_DRIVER_URL)}
                className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium"
              >
                설치하기
              </button>
              <button
                onClick={autoAudio.rescan}
                className="text-xs px-3 py-1.5 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
              >
                재검사
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
