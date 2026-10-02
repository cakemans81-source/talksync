'use client';

import { useRef, useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { attachVAD, type VADCallbacks, type VADOptions } from '@/lib/systemAudioCapture';
import { isPhysicalOutputDevice, isVirtualAudioDevice } from '@/lib/audioDeviceBinding';

// ─────────────────────────────────────────────
// AudioRouter — 입력 캡처(마이크/시스템 오디오) + VAD 연결 + 이어폰 재생
//
// 가상 마이크(TalkSync Tx) 출력은 useGeminiLive가 config.virtualMicDeviceId로
// 자체 AudioContext.setSinkId 라우팅을 담당한다. 이 라우터는 가상 마이크로
// 아무것도 송출하지 않는다.
//
// [setSinkId 브라우저 지원]
//   - Chrome 71+ 만 지원, Firefox 미지원
//   - HTTPS 또는 localhost 환경에서만 동작
//   - navigator.mediaDevices.enumerateDevices() 로 장치 목록 조회
// ─────────────────────────────────────────────

export type AudioDevice = {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
};

class AudioRouter {
  private ctx: AudioContext;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode;
  // getMicLevel()이 매 프레임 호출되므로 버퍼 재사용 (프레임당 할당 제거)
  private micLevelBuf: Float32Array<ArrayBuffer>;
  private earphoneDeviceId: string = 'default';
  private micDeviceId: string = 'default';

  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;

  // 재생 중인 이어폰 <audio> 정지 함수들 — destroy() 시 모두 중단
  private activePlaybacks = new Set<() => void>();
  private destroyed = false;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 2048;
    this.micLevelBuf = new Float32Array(this.micAnalyser.fftSize);
  }

  // ── 장치 목록 조회 ───────────────────────────
  static async enumerateDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* 이미 허용 or 불가 */ }

    const all = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: all
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `마이크 (${d.deviceId.slice(0, 8)})`, kind: d.kind })),
      outputs: all
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `스피커 (${d.deviceId.slice(0, 8)})`, kind: d.kind })),
    };
  }

  /**
   * 재생 장치 누수 검증용 출력 장치 목록.
   * 이미 권한이 있어 label이 보이면 enumerateDevices()만 호출한다 (TTS 재생마다 마이크를 열지 않음).
   * label이 전부 비어 있으면(권한 전) 기존 getUserMedia 권한 프라이밍 경로로 폴백한다.
   * 반환 형태(label 대체 문자열 포함)는 enumerateDevices().outputs 와 동일하다.
   */
  private static async listOutputDevicesForGuard(): Promise<AudioDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    const outputs = all.filter((d) => d.kind === 'audiooutput');
    if (outputs.some((d) => d.label)) {
      return outputs.map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `스피커 (${d.deviceId.slice(0, 8)})`,
        kind: d.kind,
      }));
    }
    const { outputs: primed } = await AudioRouter.enumerateDevices();
    return primed;
  }

  async setEarphoneDevice(deviceId: string): Promise<void> {
    this.earphoneDeviceId = deviceId;
  }

  // ── Blob → 이어폰 (setSinkId 적용) ──────────
  async playBlobToEarphone(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    let targetSinkId = this.earphoneDeviceId;
    console.log('[AudioRouter] Earphone Target Device ID:', targetSinkId);

    // 1. 만약 earphoneDeviceId가 'default'인 경우 시스템 기본값인 가상 마이크(VAC)로의 누수 방어
    if (targetSinkId === 'default') {
      try {
        const outputs = await AudioRouter.listOutputDevicesForGuard();
        const physicalOutput = outputs.find(isPhysicalOutputDevice);
        if (physicalOutput) {
          targetSinkId = physicalOutput.deviceId;
          console.log('[AudioRouter] earphoneDeviceId가 default이므로 물리 장치 자동 대체 바인딩:', physicalOutput.label);
        } else {
          URL.revokeObjectURL(url);
          throw new Error('물리 스피커/이어폰 장치를 찾을 수 없어 재생을 거부합니다. (누수 방어)');
        }
      } catch (e) {
        URL.revokeObjectURL(url);
        throw new Error(`디바이스 자동 감지 실패 및 재생 차단: ${(e as Error).message}`);
      }
    } else {
      // 2. 지정된 장치가 가상 디바이스인지 검증하여 차단
      try {
        const outputs = await AudioRouter.listOutputDevicesForGuard();
        const currentDevice = outputs.find((d) => d.deviceId === targetSinkId);
        if (currentDevice && isVirtualAudioDevice(currentDevice)) {
          URL.revokeObjectURL(url);
          throw new Error(`가상 장치로의 이어폰 출력 재생이 거부되었습니다: ${currentDevice.label}`);
        }
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
    }

    try {
      const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof audioWithSink.setSinkId === 'function') {
        await audioWithSink.setSinkId(targetSinkId);
        console.log('[AudioRouter] setSinkId(earphone) 성공:', targetSinkId);
      } else {
        URL.revokeObjectURL(url);
        throw new Error('setSinkId 미지원 브라우저 환경입니다.');
      }
    } catch (e) {
      URL.revokeObjectURL(url);
      console.error('[AudioRouter] setSinkId(earphone) 실패로 재생이 유출 차단되었습니다:', e);
      throw e;
    }

    // 장치 검증/setSinkId await 중 라우터가 파괴됐으면 재생하지 않음
    if (this.destroyed) {
      URL.revokeObjectURL(url);
      return;
    }

    // 종료 경로(ended / error / destroy() 정지 / play() 거부)는 정확히 한 번만 정리 + settle.
    // 재생 중 미디어 오류는 resolve 처리(경고 로그) — 호출자(커스텀 TTS)가 await 후 AEC mute를
    // 갱신하므로 Promise가 영원히 대기하지 않게 한다. play() 자체 거부는 기존처럼 throw.
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: unknown) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        this.activePlaybacks.delete(stop);
        URL.revokeObjectURL(url);
        if (err === undefined) resolve();
        else reject(err);
      };
      const stop = () => {
        try { audio.pause(); } catch { /* 무시 */ }
        settle();
        audio.removeAttribute('src');
        try { audio.load(); } catch { /* 무시 */ }
      };
      this.activePlaybacks.add(stop);

      audio.onended = () => settle();
      audio.onerror = () => {
        console.warn('[AudioRouter] 이어폰 재생 오류 — 재생 종료로 처리:', audio.error?.code, audio.error?.message);
        settle();
      };
      audio.play().catch((e: unknown) => {
        try { audio.pause(); } catch { /* 무시 */ }
        settle(e ?? new Error('audio.play() 실패'));
      });
    });
  }

  async setMicDevice(deviceId: string): Promise<void> {
    this.micDeviceId = deviceId;
  }

  async captureMic(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 16000,
    };
    if (this.micDeviceId && this.micDeviceId !== 'default') {
      audioConstraints.deviceId = { exact: this.micDeviceId };
    }
    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    // 재호출 시 이전 마이크 트랙/소스 정리 (새 캡처 성공 후 교체 → 실패 시 기존 캡처 유지)
    this.releaseMic();
    this.micStream = nextStream;
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.micAnalyser); // 스피커 연결 금지 → 하울링 방지
  }

  private releaseMic(): void {
    try { this.micSource?.disconnect(); } catch { /* 이미 해제됨 */ }
    this.micSource = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  private replaceSysStream(next: MediaStream): void {
    const prev = this.sysStream;
    this.sysStream = next;
    if (prev && prev !== next) prev.getTracks().forEach((t) => t.stop());
  }

  async captureSystemAudio(): Promise<void> {
    // ── Electron 경로: getUserMedia + chromeMediaSource 정석 ──────────────
    // Chromium 스펙:
    //   audio mandatory에는 chromeMediaSourceId를 넣지 않음 (넣으면 silent stream)
    //   video mandatory에만 sourceId를 바인딩해야 loopback audio가 올바르게 캡처됨
    const win = window as Window & { electronAPI?: { getSystemAudioSourceId: () => Promise<string | null> } };
    if (win.electronAPI?.getSystemAudioSourceId) {
      const sourceId = await win.electronAPI.getSystemAudioSourceId();
      if (!sourceId) throw new Error('시스템 오디오 소스를 찾을 수 없어요');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: { chromeMediaSource: 'desktop' },
        } as unknown as MediaTrackConstraints,
        video: {
          mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId },
        } as unknown as MediaTrackConstraints,
      });

      // video 트랙은 즉시 종료 (오디오만 필요)
      stream.getVideoTracks().forEach((t) => t.stop());

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('시스템 오디오 트랙 없음 — 사운드 카드 설정을 확인해 주세요');

      // ── 디버깅: 트랙 생존 여부 확인 ──
      console.log('🎙️ Track Settings:', audioTrack.getSettings());
      console.log('🎙️ Track Status (muted/enabled):', audioTrack.muted, audioTrack.enabled);

      // 오디오 트랙만 있는 새 MediaStream — stream.active = true 보장
      this.replaceSysStream(new MediaStream([audioTrack]));
      return;
    }

    // ── 브라우저 fallback: getDisplayMedia (탭 공유 방식) ────────
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 },
    } as DisplayMediaStreamOptions);
    // video 트랙은 의도적으로 유지 — Chrome에서 getDisplayMedia의 video를 멈추면 공유 세션과 함께 탭 오디오도 끝날 수 있음
    this.replaceSysStream(displayStream);

    const audioTrack = displayStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error('오디오 트랙 없음 — 화면 공유 시 "오디오도 공유" 체크 필수');
  }

  getMicLevel(): number {
    const buf = this.micLevelBuf;
    this.micAnalyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.min(Math.sqrt(sum / buf.length) * 10, 1);
  }

  // ── Silero VAD (WebAssembly) — RMS 폴백 자동 적용 ────────
  // attachVAD()를 통해 기존 캡처된 스트림에 신경망 VAD를 붙임
  // muteUntilRef로 응답 재생 중 AEC 게이트 적용
  async startVADWeb(
    source: 'mic' | 'sys' | MediaStream,
    callbacks: VADCallbacks,
    options?: VADOptions & { muteUntilRef?: MutableRefObject<number> }
  ): Promise<() => void> {
    let stream: MediaStream | null;
    if (source instanceof MediaStream) {
      stream = source;
    } else {
      stream = source === 'mic' ? this.micStream : this.sysStream;
    }
    if (!stream) throw new Error(`[AudioRouter] 스트림이 없습니다 — capture 먼저 호출하세요`);
    return attachVAD(stream, callbacks, options);
  }

  get isMicActive() { return !!this.micStream?.active; }
  get isSysActive() { return !!this.sysStream?.active; }

  destroy(): void {
    this.destroyed = true;
    // 재생 중인 이어폰 TTS 정지 (각 playBlobToEarphone Promise는 resolve됨)
    Array.from(this.activePlaybacks).forEach((stop) => stop());
    this.activePlaybacks.clear();
    this.releaseMic();
    this.sysStream?.getTracks().forEach((t) => t.stop());
    this.sysStream = null;
    this.ctx.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────
// React Hook
// ─────────────────────────────────────────────
export function useAudioRouter() {
  const routerRef = useRef<AudioRouter | null>(null);
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({
    inputs: [], outputs: [],
  });

  const getRouter = useCallback((): AudioRouter => {
    if (!routerRef.current) routerRef.current = new AudioRouter();
    return routerRef.current;
  }, []);

  const refreshDevices = useCallback(async () => {
    const d = await AudioRouter.enumerateDevices();
    setDevices(d);
    return d;
  }, []);

  const captureMic = useCallback(async () => getRouter().captureMic(), [getRouter]);
  const captureSystemAudio = useCallback(async () => getRouter().captureSystemAudio(), [getRouter]);
  const setMicDevice = useCallback(async (id: string) => getRouter().setMicDevice(id), [getRouter]);
  // 호환용 no-op: 가상 마이크 출력 장치는 useGeminiLive의 config.virtualMicDeviceId가 담당.
  // (레거시 파이프라인 제거 전에도 start()를 호출하지 않는 한 값 저장 외 효과가 없었음)
  const setVirtualMicDevice: (deviceId: string) => Promise<void> = useCallback(async () => {}, []);
  const setEarphoneDevice = useCallback(async (id: string) => getRouter().setEarphoneDevice(id), [getRouter]);
  const playBlobToEarphone = useCallback(async (blob: Blob) => getRouter().playBlobToEarphone(blob), [getRouter]);
  const getMicLevel = useCallback(() => routerRef.current?.getMicLevel() ?? 0, []);
  const startVADWeb = useCallback(
    (
      source: 'mic' | 'sys' | MediaStream,
      callbacks: VADCallbacks,
      options?: VADOptions & { muteUntilRef?: MutableRefObject<number> }
    ) => getRouter().startVADWeb(source, callbacks, options),
    [getRouter]
  );

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
      routerRef.current?.destroy();
      routerRef.current = null;
    };
  }, [refreshDevices]);

  // 참조 안정 반환 객체 — devices가 바뀔 때만 새 객체.
  // isMicActive/isSysActive는 getter로 routerRef를 매번 읽으므로 memo돼도 항상 최신 값.
  return useMemo(
    () => ({
      devices, refreshDevices,
      captureMic, captureSystemAudio,
      setMicDevice, setVirtualMicDevice, setEarphoneDevice,
      playBlobToEarphone,
      getMicLevel, startVADWeb,
      get isMicActive() { return routerRef.current?.isMicActive ?? false; },
      get isSysActive() { return routerRef.current?.isSysActive ?? false; },
    }),
    [
      devices, refreshDevices,
      captureMic, captureSystemAudio,
      setMicDevice, setVirtualMicDevice, setEarphoneDevice,
      playBlobToEarphone,
      getMicLevel, startVADWeb,
    ]
  );
}
