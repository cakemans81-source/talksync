'use client';

import { useRef, useCallback, useEffect, useState } from 'react';

// ─────────────────────────────────────────────
// 가상 오디오 케이블 설치 & 브라우저 연동 가이드
//
// [Windows - VB-Audio Virtual Cable (무료)]
//   1. https://vb-audio.com/Cable/ → VBCABLE_Driver_Pack45.zip 다운로드
//   2. VBCABLE_Setup_x64.exe 를 "관리자 권한"으로 실행 후 재부팅
//   3. 사운드 설정에서 "CABLE Input" / "CABLE Output" 장치 확인
//   4. Discord/Teams 마이크 설정: "CABLE Output" 선택
//   5. TalkSync UI 가상 마이크 출력: "CABLE Input" 선택
//
// [macOS - BlackHole (무료)]
//   1. brew install blackhole-2ch  또는 https://existential.audio/blackhole/
//   2. 오디오 MIDI 설정 앱에서 "BlackHole 2ch" 확인
//   3. Discord/Teams 마이크: "BlackHole 2ch" 선택
//   4. TalkSync UI 가상 마이크 출력: "BlackHole 2ch" 선택
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
  private sysSource: MediaStreamAudioSourceNode | null = null;
  private sysAnalyser: AnalyserNode;

  // [가상 마이크 핵심 구조]
  // Web Audio 파이프: source.connect(virtualMicDest)
  //   → virtualMicAudioEl.srcObject = virtualMicDest.stream
  //   → setSinkId("CABLE Input") → VB-Cable Input으로 재생
  //   → Discord는 "CABLE Output"을 마이크로 인식
  private virtualMicDest: MediaStreamAudioDestinationNode;
  private virtualMicAudioEl: HTMLAudioElement | null = null;
  private virtualMicDeviceId: string = 'default';
  private earphoneDeviceId: string = 'default';
  private micDeviceId: string = 'default';

  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;

  // 현재 재생 중인 TTS 소스 (중복 재생 방지용)
  private virtualMicSource: AudioBufferSourceNode | null = null;
  private earphoneSource: AudioBufferSourceNode | null = null;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.micAnalyser = this.ctx.createAnalyser();
    this.micAnalyser.fftSize = 2048;
    this.sysAnalyser = this.ctx.createAnalyser();
    this.sysAnalyser.fftSize = 2048;
    this.virtualMicDest = this.ctx.createMediaStreamDestination();
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

  private async applySinkId(el: HTMLAudioElement, deviceId: string): Promise<void> {
    try {
      await (el as HTMLAudioElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId);
    } catch (e) {
      console.warn('[AudioRouter] setSinkId 실패 (Chrome 전용, HTTPS 필요):', e);
    }
  }

  async setVirtualMicDevice(deviceId: string): Promise<void> {
    this.virtualMicDeviceId = deviceId;
    if (this.virtualMicAudioEl) await this.applySinkId(this.virtualMicAudioEl, deviceId);
  }

  async setEarphoneDevice(deviceId: string): Promise<void> {
    this.earphoneDeviceId = deviceId;
  }

  // ── 가상 마이크 스트리밍 시작 ────────────────
  // 이 메서드를 파이프라인 시작 시 한 번 호출하면
  // 이후 routeTTSToVirtualMic() 으로 보내는 모든 오디오가
  // setSinkId로 지정한 VB-Cable Input 장치로 자동 스트리밍됨
  async startVirtualMicPlayback(): Promise<void> {
    if (this.virtualMicAudioEl) return;
    this.virtualMicAudioEl = new Audio();
    this.virtualMicAudioEl.srcObject = this.virtualMicDest.stream;
    this.virtualMicAudioEl.muted = false;
    await this.applySinkId(this.virtualMicAudioEl, this.virtualMicDeviceId);
    await this.virtualMicAudioEl.play();
  }

  // ── 모든 TTS 재생 즉시 중단 ──────────────────
  stopAllTTS(): void {
    if (this.virtualMicSource) {
      try { this.virtualMicSource.stop(); } catch { /* 이미 종료됨 */ }
      this.virtualMicSource = null;
    }
    if (this.earphoneSource) {
      try { this.earphoneSource.stop(); } catch { /* 이미 종료됨 */ }
      this.earphoneSource = null;
    }
  }

  // ── TTS AudioBuffer → 가상 마이크 ───────────
  // 이전 재생이 남아있으면 중단 후 새 오디오로 교체
  async routeTTSToVirtualMic(audioBuffer: AudioBuffer): Promise<void> {
    if (this.virtualMicSource) {
      try { this.virtualMicSource.stop(); } catch { /* 이미 종료됨 */ }
      this.virtualMicSource = null;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.virtualMicDest);
    this.virtualMicSource = source;
    source.start();
    return new Promise((r) => {
      source.onended = () => {
        if (this.virtualMicSource === source) this.virtualMicSource = null;
        r();
      };
    });
  }

  // ── TTS AudioBuffer → 이어폰 ─────────────────
  // 이전 재생이 남아있으면 중단 후 새 오디오로 교체
  async routeTTSToEarphone(audioBuffer: AudioBuffer): Promise<void> {
    if (this.earphoneSource) {
      try { this.earphoneSource.stop(); } catch { /* 이미 종료됨 */ }
      this.earphoneSource = null;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);
    this.earphoneSource = source;
    source.start();
    return new Promise((r) => {
      source.onended = () => {
        if (this.earphoneSource === source) this.earphoneSource = null;
        r();
      };
    });
  }

  // ── Blob → 이어폰 (setSinkId 적용) ──────────
  async playBlobToEarphone(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    await this.applySinkId(audio, this.earphoneDeviceId);
    await audio.play();
    return new Promise((r) => {
      audio.onended = () => { URL.revokeObjectURL(url); r(); };
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
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.micAnalyser); // 스피커 연결 금지 → 하울링 방지
  }

  async captureSystemAudio(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    // ── Electron 경로: desktopCapturer로 팝업 없이 즉시 캡처 ────
    const win = window as Window & { electronAPI?: { getSystemAudioSourceId: () => Promise<string | null> } };
    if (win.electronAPI?.getSystemAudioSourceId) {
      const sourceId = await win.electronAPI.getSystemAudioSourceId();
      if (!sourceId) throw new Error('시스템 오디오 소스를 찾을 수 없어요');

      // Chromium은 desktop 캡처 시 video도 함께 요청해야 audio가 동작함
      const desktopConstraints = { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId };
      const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, ms: number) =>
        Promise.race([
          navigator.mediaDevices.getUserMedia(constraints),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('시스템 오디오 캡처 타임아웃 (5초)')), ms)
          ),
        ]);
      const stream = await getUserMediaWithTimeout({
        audio: { mandatory: desktopConstraints } as unknown as MediaTrackConstraints,
        video: { mandatory: desktopConstraints } as unknown as MediaTrackConstraints,
      } as MediaStreamConstraints, 5000);

      // video 트랙은 즉시 종료 (오디오만 필요)
      stream.getVideoTracks().forEach((t) => t.stop());

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) throw new Error('시스템 오디오 트랙 없음 — 사운드 카드 설정을 확인해 주세요');
      this.sysStream = stream;
      this.sysSource = this.ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      this.sysSource.connect(this.sysAnalyser);
      return;
    }

    // ── 브라우저 fallback: getDisplayMedia (탭 공유 방식) ────────
    this.sysStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 16000 },
    } as DisplayMediaStreamOptions);

    const audioTrack = this.sysStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error('오디오 트랙 없음 — 화면 공유 시 "오디오도 공유" 체크 필수');

    this.sysSource = this.ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    this.sysSource.connect(this.sysAnalyser);
  }

  getVirtualMicStream(): MediaStream { return this.virtualMicDest.stream; }

  getMicLevel(): number {
    const buf = new Float32Array(this.micAnalyser.fftSize);
    this.micAnalyser.getFloatTimeDomainData(buf);
    return Math.min(Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length) * 10, 1);
  }

  getSysLevel(): number {
    const buf = new Float32Array(this.sysAnalyser.fftSize);
    this.sysAnalyser.getFloatTimeDomainData(buf);
    return Math.min(Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length) * 10, 1);
  }

  // ── VAD (Voice Activity Detection) ──────────
  // AnalyserNode RMS 기반 침묵 감지
  // STT의 isFinal이 늦게 올 때 VAD로 발화 완료를 감지 → 번역 트리거
  // 사용 예: startVAD('mic', () => translatePendingInterim(), { threshold: 0.01, silenceDurationMs: 1500 })
  startVAD(
    source: 'mic' | 'sys',
    onSilence: () => void,
    options = { threshold: 0.01, silenceDurationMs: 1500 }
  ): () => void {
    const analyser = source === 'mic' ? this.micAnalyser : this.sysAnalyser;
    const buf = new Float32Array(analyser.fftSize);
    let silenceStart: number | null = null;
    let rafId: number;

    const check = () => {
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
      if (rms < options.threshold) {
        if (silenceStart === null) silenceStart = Date.now();
        else if (Date.now() - silenceStart >= options.silenceDurationMs) {
          silenceStart = null;
          onSilence(); // 1.5초 침묵 → 발화 완료로 판단
        }
      } else {
        silenceStart = null;
      }
      rafId = requestAnimationFrame(check);
    };
    rafId = requestAnimationFrame(check);
    return () => cancelAnimationFrame(rafId);
  }

  getMicStream(): MediaStream | null { return this.micStream; }
  getSysStream(): MediaStream | null { return this.sysStream; }

  get isMicActive() { return !!this.micStream?.active; }
  get isSysActive() { return !!this.sysStream?.active; }

  destroy(): void {
    this.stopAllTTS();
    this.virtualMicAudioEl?.pause();
    this.virtualMicAudioEl = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    this.micSource?.disconnect();
    this.sysSource?.disconnect();
    this.ctx.close();
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
  const setVirtualMicDevice = useCallback(async (id: string) => getRouter().setVirtualMicDevice(id), [getRouter]);
  const setEarphoneDevice = useCallback(async (id: string) => getRouter().setEarphoneDevice(id), [getRouter]);
  const startVirtualMicPlayback = useCallback(async () => getRouter().startVirtualMicPlayback(), [getRouter]);
  const routeTTSToVirtualMic = useCallback(async (buf: AudioBuffer) => getRouter().routeTTSToVirtualMic(buf), [getRouter]);
  const routeTTSToEarphone = useCallback(async (buf: AudioBuffer) => getRouter().routeTTSToEarphone(buf), [getRouter]);
  const stopAllTTS = useCallback(() => getRouter().stopAllTTS(), [getRouter]);
  const playBlobToEarphone = useCallback(async (blob: Blob) => getRouter().playBlobToEarphone(blob), [getRouter]);
  const getVirtualMicStream = useCallback(() => getRouter().getVirtualMicStream(), [getRouter]);
  const getMicLevel = useCallback(() => routerRef.current?.getMicLevel() ?? 0, []);
  const getSysLevel = useCallback(() => routerRef.current?.getSysLevel() ?? 0, []);
  const getMicStream = useCallback(() => routerRef.current?.getMicStream() ?? null, []);
  const getSysStream = useCallback(() => routerRef.current?.getSysStream() ?? null, []);
  const startVAD = useCallback(
    (source: 'mic' | 'sys', onSilence: () => void, opts?: { threshold: number; silenceDurationMs: number }) =>
      getRouter().startVAD(source, onSilence, opts),
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

  return {
    devices, refreshDevices,
    captureMic, captureSystemAudio,
    setMicDevice, setVirtualMicDevice, setEarphoneDevice, startVirtualMicPlayback,
    routeTTSToVirtualMic, routeTTSToEarphone, playBlobToEarphone, stopAllTTS,
    getVirtualMicStream, getMicLevel, getSysLevel, startVAD,
    getMicStream, getSysStream,
    get isMicActive() { return routerRef.current?.isMicActive ?? false; },
    get isSysActive() { return routerRef.current?.isSysActive ?? false; },
  };
}
