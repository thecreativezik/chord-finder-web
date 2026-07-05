// Lightweight playback state for an <audio> element. The current time is
// pushed via requestAnimationFrame (throttled) while playing, so the scrubber
// and chord highlight follow the song without 60fps React churn.

import { useCallback, useEffect, useRef, useState } from "react";

const TIME_EPSILON = 0.04; // ~25fps max state updates

export interface Playback {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  toggle: () => void;
  seek: (seconds: number) => void;
}

export function usePlayback(audio: HTMLAudioElement | null): Playback {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastPushRef = useRef(0);

  useEffect(() => {
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
    };
  }, [audio]);

  useEffect(() => {
    if (!isPlaying || !audio) return;

    const tick = () => {
      const time = audio.currentTime;
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
  }, [isPlaying, audio]);

  const toggle = useCallback(() => {
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, [audio]);

  const seek = useCallback(
    (seconds: number) => {
      if (!audio) return;
      audio.currentTime = seconds;
      setCurrentTime(seconds);
    },
    [audio],
  );

  return { isPlaying, currentTime, duration, toggle, seek };
}

/** Format seconds as m:ss. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
