import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.12;

export type MetronomeDensity = 0.5 | 1 | 2;

interface ClickPoint {
  time: number;
  accent: boolean;
}

interface ScheduledClick {
  oscillator: OscillatorNode;
  gain: GainNode;
}

interface UseMetronomeInput {
  audio: HTMLAudioElement | null;
  beats: number[];
  isPlaying: boolean;
  playbackRate: number;
}

export interface Metronome {
  enabled: boolean;
  density: MetronomeDensity;
  volume: number;
  toggle: () => void;
  setDensity: (density: MetronomeDensity) => void;
  setVolume: (volume: number) => void;
}

function firstAfter(points: ClickPoint[], time: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildClickPoints(beats: number[], density: MetronomeDensity): ClickPoint[] {
  if (density === 0.5) {
    return beats.filter((_, index) => index % 2 === 0).map((time, index) => ({
      time,
      accent: index % 2 === 0,
    }));
  }

  const points: ClickPoint[] = [];
  for (let index = 0; index < beats.length; index++) {
    points.push({ time: beats[index], accent: index % 4 === 0 });
    if (density === 2 && index < beats.length - 1) {
      points.push({ time: (beats[index] + beats[index + 1]) / 2, accent: false });
    }
  }
  return points;
}

function scheduleClick(
  context: AudioContext,
  when: number,
  accent: boolean,
  volume: number,
): ScheduledClick {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = accent ? 1320 : 880;
  gain.gain.setValueAtTime(Math.max(0.0001, volume * (accent ? 0.34 : 0.22)), when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(when);
  oscillator.stop(when + 0.05);
  return { oscillator, gain };
}

function cancelClick(click: ScheduledClick): void {
  try {
    click.oscillator.stop();
  } catch {
    // The oscillator may already have completed naturally.
  }
  click.oscillator.disconnect();
  click.gain.disconnect();
}

/** A look-ahead scheduler that follows Essentia's detected beat grid. */
export function useMetronome({
  audio,
  beats,
  isPlaying,
  playbackRate,
}: UseMetronomeInput): Metronome {
  const [enabled, setEnabled] = useState(false);
  const [density, setDensity] = useState<MetronomeDensity>(1);
  const [volume, setVolumeState] = useState(0.7);
  const contextRef = useRef<AudioContext | null>(null);
  const clickPoints = useMemo(() => buildClickPoints(beats, density), [beats, density]);

  const toggle = useCallback(() => {
    const next = !enabled;
    if (next) {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      if (context.state === "suspended") void context.resume();
    }
    setEnabled(next);
  }, [enabled]);

  const setVolume = useCallback((next: number) => {
    setVolumeState(Math.max(0, Math.min(1, next)));
  }, []);

  useEffect(() => {
    if (!enabled || !isPlaying || !audio || clickPoints.length === 0) return;
    const context = contextRef.current;
    if (!context) return;

    let lastAudioTime = audio.currentTime;
    let nextIndex = firstAfter(clickPoints, lastAudioTime - 0.01);
    const scheduled = new Set<ScheduledClick>();

    const cancelScheduled = () => {
      for (const click of scheduled) cancelClick(click);
      scheduled.clear();
    };

    const resetCursor = () => {
      cancelScheduled();
      lastAudioTime = audio.currentTime;
      nextIndex = firstAfter(clickPoints, lastAudioTime - 0.01);
    };

    const schedule = () => {
      if (audio.seeking) return;
      const audioTime = audio.currentTime;
      // A seek or A/B loop invalidates the old cursor; restart from the new position.
      if (audioTime < lastAudioTime - 0.08 || audioTime > lastAudioTime + 0.5) {
        resetCursor();
      }

      const songHorizon = audioTime + SCHEDULE_AHEAD_SEC * playbackRate;
      while (nextIndex < clickPoints.length && clickPoints[nextIndex].time <= songHorizon) {
        const point = clickPoints[nextIndex];
        // Never bunch overdue beats together after a delayed timer or short seek.
        if (point.time >= audioTime - 0.02) {
          const delay = Math.max(0, (point.time - audioTime) / playbackRate);
          const click = scheduleClick(context, context.currentTime + delay, point.accent, volume);
          scheduled.add(click);
          click.oscillator.addEventListener("ended", () => {
            if (!scheduled.delete(click)) return;
            click.oscillator.disconnect();
            click.gain.disconnect();
          }, { once: true });
        }
        nextIndex += 1;
      }
      lastAudioTime = audioTime;
    };

    audio.addEventListener("seeking", cancelScheduled);
    audio.addEventListener("seeked", resetCursor);
    audio.addEventListener("pause", cancelScheduled);
    audio.addEventListener("ended", cancelScheduled);
    schedule();
    const interval = window.setInterval(schedule, LOOKAHEAD_MS);
    return () => {
      window.clearInterval(interval);
      audio.removeEventListener("seeking", cancelScheduled);
      audio.removeEventListener("seeked", resetCursor);
      audio.removeEventListener("pause", cancelScheduled);
      audio.removeEventListener("ended", cancelScheduled);
      cancelScheduled();
    };
  }, [audio, clickPoints, enabled, isPlaying, playbackRate, volume]);

  useEffect(() => {
    return () => {
      const context = contextRef.current;
      contextRef.current = null;
      if (context) void context.close();
    };
  }, []);

  return { enabled, density, volume, toggle, setDensity, setVolume };
}
