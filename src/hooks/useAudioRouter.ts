'use client';

import { useRef, useCallback, useEffect, useState, type MutableRefObject } from 'react';
import { attachVAD, mixStreams, type VADCallbacks, type VADOptions } from '@/lib/systemAudioCapture';

// ─────────────────────────────────────────────
// 가상 오디오 케이블 설치 & 브라우저 연동 가이드
//
// [Windows - TalkSync Virtual Audio Cable (또는 VB-Audio Virtual Cable)]
//   1. TalkSync 드라이버 설치 (또는 https://vb-audio.com/Cable/)
//   2. 설치 후 재부팅
//   3. 사운드 설정에서 TalkSync Tx / TalkSync Rx 장치 확인
//   4. Discord/Teams 출력 장치: "TalkSync Virtual Audio Cable" 선택
//   5. TalkSync UI 가상 마이크 출력: "TalkSync Tx" 선택
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

// AudioContext 확장 타입 — setSinkId는 Chrome 110+ 지원
type AudioContextWithSink = AudioContext & { setSinkId?: (id: string) => Promise<void> };

class AudioRouter {
  private ctx: AudioContext;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micAnalyser: AnalyserNode;
  private sysSource: MediaStreamAudioSourceNode | null = null;
  private sysAnalyser: AnalyserNode;

  // [가상 마이크 핵심 구조 — AudioContext.setSinkId 방식]
  // MP3 → virtualMicCtx(AudioContext) → setSinkId("TalkSync Tx") → TalkSync Tx
  // → Discord는 TalkSync Rx를 마이크로 인식
  // HTMLAudioElement.setSinkId 대신 AudioContext.setSinkId 사용 — 더 신뢰성 높음
  private virtualMicCtx: AudioContextWithSink | null = null;
  // virtualMicCtx를 항상 활성 상태로 유지하는 무음 소스
  // TTS 없는 순간에도 TalkSync Tx에 신호를 보내 Discord가 연결을 끊지 않도록 함
  private silentKeepAlive: ConstantSourceNode | null = null;
  // 기존 Web Audio stream 방식 (startVirtualMicPlayback 호환성 유지)
  private virtualMicDest: MediaStreamAudioDestinationNode;
  private virtualMicAudioEl: HTMLAudioElement | null = null;
  private virtualMicDeviceId: string = 'default';
  private earphoneDeviceId: string = 'default';
  private micDeviceId: string = 'default';

  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  // Two-Track: 화상회의 수신용 가상 스피커 스트림 (TalkSync Rx)
  private virtualSpeakerStream: MediaStream | null = null;
  private mixCleanup: (() => void) | null = null;

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

  // ── VirtualMic 전용 AudioContext 초기화 ──────
  // AudioContext.setSinkId()로 TalkSync Tx에 직접 바인딩
  // + 무음 ConstantSourceNode로 컨텍스트를 상시 활성 상태 유지
  //   → Discord가 TalkSync Rx를 "활성 마이크"로 지속 인식
  private async getVirtualMicCtx(): Promise<AudioContextWithSink> {
    if (!this.virtualMicCtx) {
      this.virtualMicCtx = new AudioContext() as AudioContextWithSink;
      console.log('[AudioRouter] VirtualMic AudioContext 생성');
      console.log('[AudioRouter] AudioContext.setSinkId 지원:', typeof this.virtualMicCtx.setSinkId === 'function');
      await this.applyCtxSinkId(this.virtualMicCtx, this.virtualMicDeviceId);

      // 무음(0 게인) 상시 신호 → TalkSync Tx 연결 유지
      const silentGain = this.virtualMicCtx.createGain();
      silentGain.gain.value = 0;
      this.silentKeepAlive = this.virtualMicCtx.createConstantSource();
      this.silentKeepAlive.connect(silentGain);
      silentGain.connect(this.virtualMicCtx.destination);
      this.silentKeepAlive.start();
    }
    if (this.virtualMicCtx.state === 'suspended') await this.virtualMicCtx.resume();
    return this.virtualMicCtx;
  }

  private async applyCtxSinkId(ctx: AudioContextWithSink, deviceId: string): Promise<void> {
    console.log('[AudioRouter] AudioContext.setSinkId 시도 → deviceId:', deviceId);
    try {
      if (typeof ctx.setSinkId === 'function') {
        await ctx.setSinkId(deviceId);
        console.log('[AudioRouter] AudioContext.setSinkId 성공 ✓ → deviceId:', deviceId);
      } else {
        console.error('[AudioRouter] AudioContext.setSinkId 미지원 — Electron/Chrome 버전 확인 필요');
      }
    } catch (e) {
      console.error('[AudioRouter] AudioContext.setSinkId 실패:', (e as Error)?.message ?? e, '| deviceId:', deviceId);
    }
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
    // AudioContext.setSinkId로 실시간 라우팅 장치 변경
    if (this.virtualMicCtx) await this.applyCtxSinkId(this.virtualMicCtx, deviceId);
    // HTMLAudioElement 방식 폴백도 업데이트
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

  // ── MP3 ArrayBuffer → 가상 마이크 (TalkSync Tx) ─
  // AudioContext.setSinkId()로 TalkSync Tx에 직접 라우팅 (Chrome 110+)
  // HTMLAudioElement.setSinkId보다 신뢰성 높음
  async routeMP3ToVirtualMic(mp3: ArrayBuffer): Promise<void> {
    const ctx = await this.getVirtualMicCtx();
    const audioBuffer = await ctx.decodeAudioData(mp3.slice(0));
    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      source.start();
    });
  }

  // ── Blob → 가상 마이크 (AudioContext.setSinkId 적용) ─
  async playBlobToVirtualMic(blob: Blob): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    return this.routeMP3ToVirtualMic(arrayBuffer);
  }

  // ── Blob → 이어폰 (setSinkId 적용) ──────────
  async playBlobToEarphone(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    console.log('[AudioRouter] Earphone Target Device ID:', this.earphoneDeviceId);

    try {
      const audioWithSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof audioWithSink.setSinkId === 'function') {
        await audioWithSink.setSinkId(this.earphoneDeviceId);
        console.log('[AudioRouter] setSinkId(earphone) 성공:', this.earphoneDeviceId);
      } else {
        console.error('[AudioRouter] setSinkId 미지원 — Chrome 71+ 필요');
      }
    } catch (e) {
      console.error('[AudioRouter] setSinkId(earphone) 실패:', e, '| deviceId:', this.earphoneDeviceId);
    }

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mandatory: { chromeMediaSource: 'desktop' },
        } as unknown as MediaTrackConstraints,
        video: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      this.sysStream = new MediaStream([audioTrack]);
      this.sysSource = this.ctx.createMediaStreamSource(this.sysStream);
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

  // ── Two-Track: 화상회의 수신 스트림 캡처 (TalkSync Rx) ──
  async captureVirtualSpeaker(deviceId: string): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const constraints: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 16000,
    };
    if (deviceId && deviceId !== 'default') constraints.deviceId = { exact: deviceId };
    this.virtualSpeakerStream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
  }

  // ── Two-Track: 물리 마이크 + 가상 스피커 믹싱 → 단일 스트림 ──
  async captureMixed(micId: string, virtualSpeakerId: string): Promise<MediaStream> {
    // 물리 마이크 캡처
    if (!this.micStream || !this.micStream.active) {
      this.micDeviceId = micId;
      await this.captureMic();
    }
    // 화상회의 수신 스트림 캡처
    if (this.mixCleanup) { this.mixCleanup(); this.mixCleanup = null; }
    await this.captureVirtualSpeaker(virtualSpeakerId);

    if (!this.micStream || !this.virtualSpeakerStream) {
      throw new Error('[AudioRouter] 믹싱 실패 — 스트림 캡처 오류');
    }
    const { mixed, cleanup } = mixStreams(this.micStream, this.virtualSpeakerStream);
    this.mixCleanup = cleanup;
    return mixed;
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

  // ── Silero VAD (WebAssembly) — RMS 폴백 자동 적용 ────────
  // attachVAD()를 통해 기존 캡처된 스트림에 신경망 VAD를 붙임
  // muteUntilRef(sysMuteUntilRef)로 TTS 재생 중 AEC 게이트 적용
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

  getMicStream(): MediaStream | null { return this.micStream; }
  getSysStream(): MediaStream | null { return this.sysStream; }

  get isMicActive() { return !!this.micStream?.active; }
  get isSysActive() { return !!this.sysStream?.active; }

  destroy(): void {
    this.stopAllTTS();
    this.virtualMicAudioEl?.pause();
    this.virtualMicAudioEl = null;
    try { this.silentKeepAlive?.stop(); } catch { /* 이미 종료됨 */ }
    this.silentKeepAlive = null;
    this.virtualMicCtx?.close();
    this.virtualMicCtx = null;
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
  const routeMP3ToVirtualMic = useCallback(async (mp3: ArrayBuffer) => getRouter().routeMP3ToVirtualMic(mp3), [getRouter]);
  const playBlobToVirtualMic = useCallback(async (blob: Blob) => getRouter().playBlobToVirtualMic(blob), [getRouter]);
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
  const startVADWeb = useCallback(
    (
      source: 'mic' | 'sys' | MediaStream,
      callbacks: VADCallbacks,
      options?: VADOptions & { muteUntilRef?: MutableRefObject<number> }
    ) => getRouter().startVADWeb(source, callbacks, options),
    [getRouter]
  );
  const captureMixed = useCallback(
    (micId: string, virtualSpeakerId: string) => getRouter().captureMixed(micId, virtualSpeakerId),
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
    captureMic, captureSystemAudio, captureMixed,
    setMicDevice, setVirtualMicDevice, setEarphoneDevice, startVirtualMicPlayback,
    routeTTSToVirtualMic, routeTTSToEarphone, routeMP3ToVirtualMic, playBlobToVirtualMic, playBlobToEarphone, stopAllTTS,
    getVirtualMicStream, getMicLevel, getSysLevel, startVAD, startVADWeb,
    getMicStream, getSysStream,
    get isMicActive() { return routerRef.current?.isMicActive ?? false; },
    get isSysActive() { return routerRef.current?.isSysActive ?? false; },
  };
}
