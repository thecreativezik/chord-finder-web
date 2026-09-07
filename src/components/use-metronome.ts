import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BeatMarker } from "../types";

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
  /** Beats in musical coordinates; the accent follows `beatInBar`, not an index. */
  beatMap: BeatMarker[];
  isPlaying: boolean;
  playbackRate: number;
  /** SoundTouch delay expressed in the same source-time units as beat times. */
  sourceLatencySec?: number;
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

/**
 * Source-timeline position feeding the click scheduler.
 *
 * Unlike the visual playhead, this must not hold at a play/seek target while
 * SoundTouch fills its first window. A negative value at the start of a song
 * is intentional: it schedules a beat at 0 after the processor's real delay.
 */
export function metronomeSourceTime(rawTime: number, sourceLatencySec: number): number {
  const safeRawTime = Number.isFinite(rawTime) ? rawTime : 0;
  const safeLatency = Number.isFinite(sourceLatencySec) ? Math.max(0, sourceLatencySec) : 0;
  return safeRawTime - safeLatency;
}

export function metronomeDelayUntilBeat(
  beatTime: number,
  rawTime: number,
  sourceLatencySec: number,
  playbackRate: number,
): number {
  const safeRate = Number.isFinite(playbackRate) ? Math.max(0.1, playbackRate) : 1;
  return Math.max(0, (beatTime - metronomeSourceTime(rawTime, sourceLatencySec)) / safeRate);
}

/**
 * Accents follow the bar, not the beat index.
 *
 * This used to be `index % 4 === 0`, which quietly asserted 4/4 with the
 * downbeat on the very first detected beat. The beat map carries the metre and
 * the estimated phase, so the click now lands the accent where the bar actually
 * starts — and a song in 3/4, or one whose tracker locked on to beat two, stops
 * being clicked against itself.
 */
export function buildClickPoints(beatMap: BeatMarker[], density: MetronomeDensity): ClickPoint[] {
  if (density === 0.5) {
    // Half the clicks, still every other beat so the pulse stays even — but
    // phased off the first downbeat rather than off beat zero. Taking the even
    // indices unconditionally drops every accent when the estimated downbeat
    // lands on an odd index, which leaves the click with no bar at all.
    //
    // In an odd metre the downbeats alternate parity, so half of them fall on
    // the skipped beats. That is inherent to halving the rate in 3/4 or 7/8;
    // an even pulse is the better of the two compromises.
    const firstDownbeat = beatMap.findIndex((marker) => marker.beatInBar === 1);
    const parity = firstDownbeat < 0 ? 0 : firstDownbeat % 2;
    return beatMap
      .filter((_, index) => index % 2 === parity)
      .map((marker) => ({ time: marker.timeSec, accent: marker.beatInBar === 1 }));
  }

  const points: ClickPoint[] = [];
  for (let index = 0; index < beatMap.length; index++) {
    points.push({ time: beatMap[index].timeSec, accent: beatMap[index].beatInBar === 1 });
    if (density === 2 && index < beatMap.length - 1) {
      points.push({
        time: (beatMap[index].timeSec + beatMap[index + 1].timeSec) / 2,
        accent: false,
      });
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
  gain.gain.setValueAtTime(
    Math.max(0.0001, Math.min(1, volume * (accent ? 0.72 : 0.5))),
    when,
  );
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
  beatMap,
  isPlaying,
  playbackRate,
  sourceLatencySec = 0,
}: UseMetronomeInput): Metronome {
  const [enabled, setEnabled] = useState(false);
  const [density, setDensity] = useState<MetronomeDensity>(1);
  const [volume, setVolumeState] = useState(1);
  const contextRef = useRef<AudioContext | null>(null);
  const clickPoints = useMemo(() => buildClickPoints(beatMap, density), [beatMap, density]);

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
    setVolumeState(Math.max(0, Math.min(1.5, next)));
  }, []);

  useEffect(() => {
    if (!enabled || !isPlaying || !audio || clickPoints.length === 0) return;
    const context = contextRef.current;
    if (!context) return;

    const schedulerTime = () => metronomeSourceTime(audio.currentTime, sourceLatencySec);
    let lastAudioTime = schedulerTime();
    let nextIndex = firstAfter(clickPoints, lastAudioTime - 0.01);
    const scheduled = new Set<ScheduledClick>();

    const cancelScheduled = () => {
      for (const click of scheduled) cancelClick(click);
      scheduled.clear();
    };

    const resetCursor = () => {
      cancelScheduled();
      lastAudioTime = schedulerTime();
      nextIndex = firstAfter(clickPoints, lastAudioTime - 0.01);
    };

    const schedule = () => {
      if (audio.seeking) return;
      const rawTime = audio.currentTime;
      const audioTime = metronomeSourceTime(rawTime, sourceLatencySec);
      // A seek or A/B loop invalidates the old cursor; restart from the new position.
      if (audioTime < lastAudioTime - 0.08 || audioTime > lastAudioTime + 0.5) {
        resetCursor();
      }

      const songHorizon = audioTime + SCHEDULE_AHEAD_SEC * playbackRate;
      while (nextIndex < clickPoints.length && clickPoints[nextIndex].time <= songHorizon) {
        const point = clickPoints[nextIndex];
        // Never bunch overdue beats together after a delayed timer or short seek.
        if (point.time >= audioTime - 0.02) {
          const delay = metronomeDelayUntilBeat(point.time, rawTime, sourceLatencySec, playbackRate);
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
    const onSeeked = () => resetCursor();
    audio.addEventListener("seeked", onSeeked);
    audio.addEventListener("pause", cancelScheduled);
    audio.addEventListener("ended", cancelScheduled);
    schedule();
    const interval = window.setInterval(schedule, LOOKAHEAD_MS);
    return () => {
      window.clearInterval(interval);
      audio.removeEventListener("seeking", cancelScheduled);
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("pause", cancelScheduled);
      audio.removeEventListener("ended", cancelScheduled);
      cancelScheduled();
    };
  }, [audio, clickPoints, enabled, isPlaying, playbackRate, sourceLatencySec, volume]);

  useEffect(() => {
    return () => {
      const context = contextRef.current;
      contextRef.current = null;
      if (context) void context.close();
    };
  }, []);

  return { enabled, density, volume, toggle, setDensity, setVolume };
}
