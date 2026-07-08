'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type BrowserTabAudioCaptureState =
  | 'idle'
  | 'selecting'
  | 'sharing'
  | 'no-audio'
  | 'ended'
  | 'error';

type DisplayMediaError = Error & { name?: string };

export function useBrowserTabAudioCapture() {
  const [state, setState] = useState<BrowserTabAudioCaptureState>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const levelRafRef = useRef<number | null>(null);

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    try { sourceRef.current?.disconnect(); } catch { /* already disconnected */ }
    sourceRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const stopCapture = useCallback((nextState: BrowserTabAudioCaptureState = 'ended') => {
    stopLevelMeter();

    const current = streamRef.current;
    current?.getTracks().forEach((track) => {
      try { track.stop(); } catch { /* already stopped */ }
    });

    streamRef.current = null;
    setStream(null);
    setAudioTrack(null);
    setSourceLabel('');
    setState(nextState);
  }, [stopLevelMeter]);

  const startLevelMeter = useCallback((track: MediaStreamTrack) => {
    stopLevelMeter();

    const audioStream = new MediaStream([track]);
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const source = ctx.createMediaStreamSource(audioStream);
    source.connect(analyser);

    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
      levelRafRef.current = requestAnimationFrame(tick);
    };

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    tick();
  }, [stopLevelMeter]);

  const startCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setState('error');
      setError('현재 환경에서는 탭 오디오 공유가 제한될 수 있습니다.');
      return;
    }

    stopCapture('idle');
    setState('selecting');
    setError(null);

    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      } as DisplayMediaStreamOptions);

      const track = captured.getAudioTracks()[0] ?? null;
      if (!track) {
        captured.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        streamRef.current = null;
        setStream(null);
        setAudioTrack(null);
        setSourceLabel('');
        setLevel(0);
        setError('오디오 track이 없습니다. 공유 창에서 오디오 공유를 켜 주세요.');
        setState('no-audio');
        return;
      }

      const endHandler = () => {
        stopCapture('ended');
      };
      captured.getTracks().forEach((mediaTrack) => {
        mediaTrack.addEventListener('ended', endHandler, { once: true });
      });

      streamRef.current = captured;
      setStream(captured);
      setAudioTrack(track);
      setSourceLabel(track.label || '선택한 탭/창 오디오');
      setError(null);
      setState('sharing');
      startLevelMeter(track);
    } catch (captureError) {
      const displayError = captureError as DisplayMediaError;
      const message =
        displayError.name === 'NotAllowedError'
          ? '공유가 취소되었습니다.'
          : '브라우저/Electron 캡처 권한을 확인하세요.';
      setError(message);
      setState(displayError.name === 'NotAllowedError' ? 'ended' : 'error');
    }
  }, [startLevelMeter, stopCapture]);

  useEffect(() => {
    return () => stopCapture('ended');
  }, [stopCapture]);

  return {
    state,
    stream,
    audioTrack,
    sourceLabel,
    error,
    level,
    hasAudioTrack: Boolean(audioTrack),
    startCapture,
    stopCapture,
  };
}
