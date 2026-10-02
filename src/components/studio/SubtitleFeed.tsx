import type { Ref } from 'react';
import type { AutoAudioState } from '@/hooks/useAutoAudioSetup';
import { LiveStatusIndicator, type LivePhase } from './GeminiLivePanel';
import { VIRTUAL_AUDIO_DRIVER_URL, type LiveSubtitle } from './constants';

// ── V2 실시간 자막 ──
export function SubtitleFeed({
  subtitles, phase, endRef,
}: {
  subtitles: LiveSubtitle[];
  phase: LivePhase;
  endRef: Ref<HTMLDivElement>;
}) {
  if (subtitles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <LiveStatusIndicator phase={phase} />
        <p className="text-sm text-zinc-400">상대방 음성을 기다리는 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      {subtitles.map((s) => (
        <div key={s.id} className="rounded-2xl p-4 bg-white border border-zinc-100 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-zinc-400">🎧 Gemini 통역</span>
            <span className="text-[10px] text-zinc-300">
              {new Date(s.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm font-medium leading-relaxed text-zinc-900">{s.text}</p>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ── 사용 가이드 ──
export function UsageGuide({
  apiKeyReady, autoAudioState, cableDetected, earphoneSelected, onOpenApiKey,
}: {
  apiKeyReady: boolean;
  autoAudioState: AutoAudioState;
  cableDetected: boolean;
  earphoneSelected: boolean;
  onOpenApiKey: () => void;
}) {
  const steps: { icon: string; title: string; desc: string; done: boolean; action?: { label: string; href: string } }[] = [
    {
      icon: '🔌',
      title: 'TalkSync 가상 오디오 감지',
      desc:
        autoAudioState === 'ready'
          ? 'TalkSync 전용 장치가 자동으로 선택됐어요'
          : autoAudioState === 'manual-review'
            ? '가상 오디오 장치가 감지됐지만 수동 확인이 필요해요'
            : '가상 오디오 드라이버가 감지되지 않았어요 — 설치 후 새로고침하세요',
      done: autoAudioState === 'ready',
      action: !cableDetected ? { label: '드라이버 설치', href: VIRTUAL_AUDIO_DRIVER_URL } : undefined,
    },
    {
      icon: '🎧',
      title: '이어폰 선택',
      desc: earphoneSelected ? '이어폰이 선택됐어요' : '아래 "이어폰 출력" 드롭다운에서 본인 헤드셋을 선택하세요',
      done: earphoneSelected,
    },
    {
      icon: '💬',
      title: 'Discord 입력(마이크)을 TalkSync Virtual Microphone으로 변경',
      desc: 'Discord → ⚙️ 설정 → 음성 및 비디오 → 입력 장치 → "TalkSync Virtual Microphone" 선택',
      done: false,
    },
    {
      icon: '🚀',
      title: 'Gemini Live Translate 시작',
      desc: '상단 패널에서 [Live Translate 시작] 버튼을 누르세요',
      done: false,
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
      <div className="w-16 h-16 bg-white border border-zinc-100 rounded-3xl flex items-center justify-center shadow-sm">
        <span className="text-3xl">🎙</span>
      </div>

      {!apiKeyReady && (
        <button
          onClick={onOpenApiKey}
          className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-xl hover:bg-amber-100 transition"
        >
          ⚠ Gemini API 키 설정 필요
        </button>
      )}

      <div className="w-full max-w-xl space-y-2">
        {steps.map(({ icon, title, desc, done, action }) => (
          <div key={title} className={`flex items-start gap-3 p-4 rounded-2xl border transition-all ${
            done ? 'bg-green-50 border-green-100' : 'bg-white border-zinc-100'
          }`}>
            <span className="text-xl mt-0.5">{done ? '✅' : icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${done ? 'text-green-700' : 'text-zinc-800'}`}>{title}</p>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{desc}</p>
              {action && (
                <a href={action.href} target="_blank" rel="noopener noreferrer"
                  className="inline-block mt-2 text-xs font-medium text-blue-600 hover:underline">
                  {action.label} →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
