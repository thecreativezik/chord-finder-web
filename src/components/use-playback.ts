// Lightweight playback state for an <audio> element. The current time is
// pushed via requestAnimationFrame (throttled) while playing, so the scrubber
// and chord highlight follow the song without 60fps React churn.

import { useCallback, useEffect, useRef, useState } from "react";

const TIME_EPSILON = 0.04; // ~25fps max state updates

export interface Playback {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  loopStart: number | null;
  loopEnd: number | null;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setLoopStart: (seconds: number) => void;
  setLoopEnd: (seconds: number) => void;
  clearLoop: () => void;
}

export function usePlayback(audio: HTMLAudioElement | null): Playback {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [loopStart, setLoopStartState] = useState<number | null>(null);
  const [loopEnd, setLoopEndState] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPushRef = useRef(0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setLoopStartState(null);
    setLoopEndState(null);
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("seeked", onTimeUpdate);

    if (audio.readyState >= 1) onDuration();

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("seeked", onTimeUpdate);
      audio.pause();
    };
  }, [audio]);

  useEffect(() => {
    if (!audio) return;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
  }, [audio, playbackRate]);

  useEffect(() => {
    if (!isPlaying || !audio) return;

    const tick = () => {
      let time = audio.currentTime;
      if (loopStart !== null && loopEnd !== null && time >= loopEnd - 0.015) {
        audio.currentTime = loopStart;
        time = loopStart;
      }
      if (Math.abs(time - lastPushRef.current) >= TIME_EPSILON) {
        lastPushRef.current = time;
        setCurrentTime(time);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, audio, loopStart, loopEnd]);

  const toggle = useCallback(() => {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [audio]);

  const seek = useCallback(
    (seconds: number) => {
      if (!audio) return;
      const next = Math.max(0, Math.min(seconds, Number.isFinite(audio.duration) ? audio.duration : seconds));
      audio.currentTime = next;
      lastPushRef.current = next;
      setCurrentTime(next);
    },
    [audio],
  );

  const skip = useCallback(
    (seconds: number) => {
      if (!audio) return;
      seek(audio.currentTime + seconds);
    },
    [audio, seek],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const next = Math.max(0.5, Math.min(1.5, rate));
      setPlaybackRateState(next);
      if (audio) {
        audio.playbackRate = next;
        audio.preservesPitch = true;
      }
    },
    [audio],
  );

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
    loopStart,
    loopEnd,
    toggle,
    seek,
    skip,
    setPlaybackRate,
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
