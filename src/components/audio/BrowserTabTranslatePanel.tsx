'use client';

import type { BrowserTabAudioCaptureState } from '@/hooks/useBrowserTabAudioCapture';

type BrowserTabTranslatePanelProps = {
  state: BrowserTabAudioCaptureState;
  sourceLabel: string;
  error: string | null;
  level: number;
  hasAudioTrack: boolean;
  targetLanguageLabel: string;
  txLanguageLabel: string;
  onStartCapture: () => void;
  onStopCapture: () => void;
};

const STATE_LABEL: Record<BrowserTabAudioCaptureState, string> = {
  idle: '오디오 선택 필요',
  selecting: '공유 대상 선택 중',
  sharing: '공유 중',
  'no-audio': '오디오 track 없음',
  ended: '공유 중단됨',
  error: '캡처 오류',
};

const STATE_DOT: Record<BrowserTabAudioCaptureState, string> = {
  idle: 'bg-zinc-300',
  selecting: 'bg-blue-500 animate-pulse',
  sharing: 'bg-emerald-500 animate-pulse',
  'no-audio': 'bg-amber-500',
  ended: 'bg-zinc-400',
  error: 'bg-red-500',
};

export function BrowserTabTranslatePanel({
  state,
  sourceLabel,
  error,
  level,
  hasAudioTrack,
  targetLanguageLabel,
  txLanguageLabel,
  onStartCapture,
  onStopCapture,
}: BrowserTabTranslatePanelProps) {
  const isSelecting = state === 'selecting';
  const isSharing = state === 'sharing';
  const levelWidth = `${Math.round(level * 100)}%`;

  return (
    <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`w-1.5 h-1.5 rounded-full ${STATE_DOT[state]}`} />
            <span className="text-xs font-semibold text-zinc-800">브라우저/탭 오디오 공유</span>
            <span className="text-[10px] font-medium text-blue-700 bg-white border border-blue-100 px-1.5 py-0.5 rounded-full">
              Capture only
            </span>
          </div>

          <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
            선택한 탭/창의 음성을 내가 들을 언어로 통역하기 위한 입력입니다. Gemini 연결은 다음 단계에서 진행합니다.
          </p>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="bg-white/80 border border-blue-100 rounded-xl px-3 py-2 min-w-0">
              <p className="text-[10px] text-zinc-400">내가 들을 언어</p>
              <p className="text-xs font-semibold text-zinc-800 truncate">{targetLanguageLabel}</p>
            </div>
            <div className="bg-white/60 border border-zinc-100 rounded-xl px-3 py-2 min-w-0 opacity-70">
              <p className="text-[10px] text-zinc-400">회의방에 보낼 AI 음성 언어</p>
              <p className="text-xs font-semibold text-zinc-500 truncate">{txLanguageLabel} · 양방향 모드에서 사용</p>
            </div>
            <div className="bg-white/80 border border-blue-100 rounded-xl px-3 py-2 min-w-0">
              <p className="text-[10px] text-zinc-400">캡처 상태</p>
              <p className="text-xs font-semibold text-zinc-800 truncate">{STATE_LABEL[state]}</p>
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          {!isSharing ? (
            <button
              onClick={onStartCapture}
              disabled={isSelecting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs font-semibold rounded-xl transition-colors shadow shadow-blue-600/20"
            >
              {isSelecting ? '선택 중...' : '오디오 공유'}
            </button>
          ) : (
            <button
              onClick={onStopCapture}
              className="px-4 py-2 bg-white hover:bg-zinc-50 border border-blue-200 text-blue-700 text-xs font-semibold rounded-xl transition-colors"
            >
              공유 중지
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`text-[11px] font-medium ${hasAudioTrack ? 'text-emerald-700' : 'text-zinc-400'}`}>
            {hasAudioTrack ? 'audio track 확인됨' : 'audio track 대기'}
          </span>
          {sourceLabel && (
            <span className="text-[11px] text-zinc-400 truncate min-w-0">
              {sourceLabel}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-zinc-400">레벨</span>
          <div className="h-1.5 w-24 rounded-full bg-white border border-blue-100 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-[width] duration-75" style={{ width: levelWidth }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 px-3 py-2 bg-white border border-amber-200 rounded-xl text-[11px] text-amber-700">
          {error}
        </div>
      )}
    </div>
  );
}
