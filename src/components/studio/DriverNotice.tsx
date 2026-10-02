import { VIRTUAL_AUDIO_DRIVER_URL } from './constants';
import { openExternal } from './openExternal';

// ── TalkSync 가상 오디오 드라이버 미감지 안내 배너 ──
export function DriverNotice({
  checking, onRescan,
}: {
  checking: boolean;
  onRescan: () => void;
}) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="text-amber-500 text-base mt-0.5">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800">
          {checking
            ? 'TalkSync 가상 오디오 드라이버를 확인 중입니다'
            : 'TalkSync 가상 오디오 드라이버가 감지되지 않았습니다'}
        </p>
        <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
          Browser Tab Translate Mode는 드라이버 없이 사용할 수 있습니다. 양방향 치환 모드와 회의방 송출은 TalkSync Virtual Speaker(Rx) / Microphone(Tx) 감지 후 활성화됩니다.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onRescan}
          className="text-xs px-3 py-1.5 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
        >
          재검사
        </button>
        <button
          onClick={() => openExternal(VIRTUAL_AUDIO_DRIVER_URL)}
          className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium"
        >
          설치하기
        </button>
      </div>
    </div>
  );
}
