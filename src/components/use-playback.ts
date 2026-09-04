// Lightweight playback state for an <audio> element. The current time is
// pushed via requestAnimationFrame (throttled) while playing, so the scrubber
// and chord highlight follow the song without 60fps React churn.

import { useCallback, useEffect, useRef, useState } from "react";

const TIME_EPSILON = 0.04; // ~25fps max state updates

interface LatencyHold {
  sourceTime: number;
  untilRawTime: number;
}

export interface Playback {
  isPlaying: boolean;
  /** The source-timeline position currently audible at the output. */
  currentTime: number;
  duration: number;
  playbackRate: number;
  sourceLatencySec: number;
  loopStart: number | null;
  loopEnd: number | null;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setSourceLatency: (seconds: number) => void;
  setLoopStart: (seconds: number) => void;
  setLoopEnd: (seconds: number) => void;
  clearLoop: () => void;
}

export function usePlayback(
  audio: HTMLAudioElement | null,
  preservePitch = true,
): Playback {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [sourceLatencySec, setSourceLatencyState] = useState(0);
  const [loopStart, setLoopStartState] = useState<number | null>(null);
  const [loopEnd, setLoopEndState] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPushRef = useRef(0);
  const currentTimeRef = useRef(0);
  const latencyRef = useRef(0);
  const latencyHoldRef = useRef<LatencyHold | null>(null);

  latencyRef.current = sourceLatencySec;

  const pushCurrentTime = useCallback((time: number) => {
    currentTimeRef.current = time;
    lastPushRef.current = time;
    setCurrentTime(time);
  }, []);

  const startLatencyHold = useCallback((sourceTime: number, rawTime: number) => {
    const latency = latencyRef.current;
    latencyHoldRef.current = latency > 0
      ? { sourceTime, untilRawTime: rawTime + latency }
      : null;
  }, []);

  const readAudibleTime = useCallback((media: HTMLMediaElement): number => {
    const rawTime = Number.isFinite(media.currentTime) ? media.currentTime : 0;
    const hold = latencyHoldRef.current;
    if (hold && rawTime < hold.untilRawTime) return hold.sourceTime;
    if (hold) latencyHoldRef.current = null;
    return Math.max(0, rawTime - latencyRef.current);
  }, []);

  useEffect(() => {
    setIsPlaying(false);
    pushCurrentTime(0);
    setDuration(0);
    setLoopStartState(null);
    setLoopEndState(null);
    latencyHoldRef.current = null;
    if (!audio) return;

    const onPlay = () => {
      startLatencyHold(currentTimeRef.current, audio.currentTime);
      setIsPlaying(true);
    };
    const onPause = () => {
      setIsPlaying(false);
      pushCurrentTime(readAudibleTime(audio));
    };
    const onEnded = () => {
      latencyHoldRef.current = null;
      setIsPlaying(false);
      pushCurrentTime(Number.isFinite(audio.duration) ? audio.duration : readAudibleTime(audio));
    };
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onSeeking = () => {
      const target = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      startLatencyHold(target, target);
      pushCurrentTime(target);
    };
    const onTimeUpdate = () => pushCurrentTime(readAudibleTime(audio));

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("seeking", onSeeking);
    audio.addEventListener("seeked", onTimeUpdate);

    if (audio.readyState >= 1) onDuration();

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("seeking", onSeeking);
      audio.removeEventListener("seeked", onTimeUpdate);
      audio.pause();
    };
  }, [audio, pushCurrentTime, readAudibleTime, startLatencyHold]);

  useEffect(() => {
    if (!audio) return;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = preservePitch;
  }, [audio, playbackRate, preservePitch]);

  useEffect(() => {
    if (!audio) return;
    if (sourceLatencySec > 0 && !audio.paused) {
      startLatencyHold(currentTimeRef.current, audio.currentTime);
      return;
    }
    latencyHoldRef.current = null;
    pushCurrentTime(readAudibleTime(audio));
  }, [audio, pushCurrentTime, readAudibleTime, sourceLatencySec, startLatencyHold]);

  useEffect(() => {
    if (!isPlaying || !audio) return;

    const tick = () => {
      let time = readAudibleTime(audio);
      if (loopStart !== null && loopEnd !== null && time >= loopEnd - 0.015) {
        audio.currentTime = loopStart;
        startLatencyHold(loopStart, loopStart);
        time = loopStart;
      }
      if (Math.abs(time - lastPushRef.current) >= TIME_EPSILON) {
        pushCurrentTime(time);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    audio,
    loopStart,
    loopEnd,
    pushCurrentTime,
    readAudibleTime,
    startLatencyHold,
  ]);

  const seek = useCallback(
    (seconds: number) => {
      if (!audio) return;
      const next = Math.max(0, Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds));
      startLatencyHold(next, next);
      audio.currentTime = next;
      pushCurrentTime(next);
    },
    [audio, pushCurrentTime, startLatencyHold],
  );

  const toggle = useCallback(() => {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [audio]);

  const skip = useCallback(
    (seconds: number) => {
      seek(currentTimeRef.current + seconds);
    },
    [seek],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const next = Math.max(0.5, Math.min(1.5, rate));
      setPlaybackRateState(next);
      if (audio) {
        audio.playbackRate = next;
        audio.preservesPitch = preservePitch;
      }
    },
    [audio, preservePitch],
  );

  const setSourceLatency = useCallback((seconds: number) => {
    setSourceLatencyState(Number.isFinite(seconds) ? Math.max(0, Math.min(1, seconds)) : 0);
  }, []);

  const setLoopStart = useCallback((seconds: number) => {
    const next = Math.max(0, seconds);
    setLoopStartState(next);
    setLoopEndState((end) => (end !== null && end > next + 0.1 ? end : null));
  }, []);

  const setLoopEnd = useCallback(
    (seconds: number) => {
      const start = loopStart ?? 0;
      const next = Math.min(duration || seconds, Math.max(seconds, start + 0.1));
      setLoopEndState(next);
    },
    [duration, loopStart],
  );

  const clearLoop = useCallback(() => {
    setLoopStartState(null);
    setLoopEndState(null);
  }, []);

  return {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    sourceLatencySec,
    loopStart,
    loopEnd,
    toggle,
    seek,
    skip,
    setPlaybackRate,
    setSourceLatency,
    setLoopStart,
    setLoopEnd,
    clearLoop,
  };
}

/** Format seconds as m:ss. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
