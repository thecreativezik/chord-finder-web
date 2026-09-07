// Musical coordinates for the detected beat grid.
//
// Essentia's RhythmExtractor2013 gives us beat *times* and nothing else: no
// bar, no beat-in-bar, no phase. Everything downstream that wants to say
// "bar 33" or "accent the downbeat" therefore has to invent that information,
// and until now the click scheduler invented it by assuming beat 0 was a
// downbeat in 4/4 (`index % 4 === 0`).
//
// This module makes that assumption explicit and testable instead: a beat map
// is derived from the beat times, a metre, and an estimated phase. It is
// always derived and never stored, because two copies of the beat times are
// two copies that drift apart.

import type { BeatMarker, ChordSegment, TimeSignature } from "../types";

export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beatsPerBar: 4, beatUnit: 4 };

/**
 * Metres offered in the UI. Detection is deliberately not attempted: guessing
 * the metre wrong renumbers every bar on screen, so the musician picks.
 *
 * `beatsPerBar` counts *detected beats* per bar, not note values. In a compound
 * metre this depends on whether the tracker locked to eighths or to dotted
 * quarters, which is why 6/8 and 12/8 are both listed.
 */
export const TIME_SIGNATURES: readonly TimeSignature[] = [
  { beatsPerBar: 2, beatUnit: 4 },
  { beatsPerBar: 3, beatUnit: 4 },
  { beatsPerBar: 4, beatUnit: 4 },
  { beatsPerBar: 5, beatUnit: 4 },
  { beatsPerBar: 6, beatUnit: 8 },
  { beatsPerBar: 7, beatUnit: 8 },
  { beatsPerBar: 12, beatUnit: 8 },
];

export function formatTimeSignature(signature: TimeSignature): string {
  return `${signature.beatsPerBar}/${signature.beatUnit}`;
}

export function parseTimeSignature(label: string): TimeSignature {
  const match = TIME_SIGNATURES.find((signature) => formatTimeSignature(signature) === label);
  return match ?? DEFAULT_TIME_SIGNATURE;
}

/** Sorted, finite, strictly increasing beat times. */
export function normalizeBeats(beats: readonly number[]): number[] {
  const sorted = beats.filter((time) => Number.isFinite(time) && time >= 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const time of sorted) {
    if (out.length === 0 || time - out[out.length - 1] > 1e-6) out.push(time);
  }
  return out;
}

/** Median interval between consecutive beats, or 0 when there are fewer than two. */
export function medianBeatInterval(beats: readonly number[]): number {
  if (beats.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i] - beats[i - 1]);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Place every beat in musical coordinates.
 *
 * Bar 1 beat 1 is the beat at index `downbeatPhase`. Beats before it are the
 * pickup and land in bar 0, which is why `bar` is signed rather than clamped —
 * silently renumbering a pickup as bar 1 would shift the whole song by a bar.
 */
export function buildBeatMap(
  beats: readonly number[],
  signature: TimeSignature = DEFAULT_TIME_SIGNATURE,
  downbeatPhase = 0,
): BeatMarker[] {
  const beatsPerBar = Math.max(1, Math.round(signature.beatsPerBar));
  const sorted = normalizeBeats(beats);
  const phase = Number.isFinite(downbeatPhase) ? floorMod(Math.round(downbeatPhase), beatsPerBar) : 0;

  return sorted.map((timeSec, index) => {
    const offset = index - phase;
    return {
      timeSec,
      bar: Math.floor(offset / beatsPerBar) + 1,
      beatInBar: floorMod(offset, beatsPerBar) + 1,
    };
  });
}

/** Downbeat times only — what the timeline ruler and bar-quantised loops use. */
export function downbeatTimes(beatMap: readonly BeatMarker[]): number[] {
  return beatMap.filter((marker) => marker.beatInBar === 1).map((marker) => marker.timeSec);
}

/** Index of the beat closest to `time`, or -1 for an empty map. */
export function nearestBeatIndex(beats: readonly number[], time: number): number {
  if (beats.length === 0) return -1;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  // `lo` is the first beat at or after `time`; its predecessor may be closer.
  if (lo > 0 && Math.abs(beats[lo - 1] - time) <= Math.abs(beats[lo] - time)) return lo - 1;
  return lo;
}

/**
 * Snap a time to the nearest downbeat. Returns the input unchanged when there
 * are no downbeats to snap to, so callers never have to special-case an
 * un-analysed session.
 */
export function snapToDownbeat(downbeats: readonly number[], time: number): number {
  if (downbeats.length === 0) return time;
  const index = nearestBeatIndex(downbeats, time);
  return index < 0 ? time : downbeats[index];
}

/**
 * The beat in effect at `time` — the last beat at or before it. Returns null
 * for an empty map or a time before the first detected beat, so callers show
 * nothing rather than an invented bar 1.
 */
export function beatAtTime(beatMap: readonly BeatMarker[], time: number): BeatMarker | null {
  if (beatMap.length === 0 || !Number.isFinite(time) || time < beatMap[0].timeSec) return null;
  let lo = 0;
  let hi = beatMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beatMap[mid].timeSec <= time) lo = mid;
    else hi = mid - 1;
  }
  return beatMap[lo];
}

/** Human label for a position in the song, e.g. "33.1" for bar 33 beat 1. */
export function formatBarBeat(marker: BeatMarker): string {
  return `${marker.bar}.${marker.beatInBar}`;
}

/**
 * Estimate which beat index carries the downbeat.
 *
 * Harmony changes land on downbeats far more often than anywhere else, and we
 * already have the decoded chord boundaries, so each chord change votes for the
 * phase of the beat it lands on. Changes that do not land near a beat abstain
 * rather than adding noise. With no votes at all this returns 0, which is the
 * behaviour the click scheduler had before the beat map existed.
 */
export function estimateDownbeatPhase(
  beats: readonly number[],
  segments: readonly ChordSegment[],
  signature: TimeSignature = DEFAULT_TIME_SIGNATURE,
): number {
  const beatsPerBar = Math.max(1, Math.round(signature.beatsPerBar));
  if (beatsPerBar === 1) return 0;
  const sorted = normalizeBeats(beats);
  if (sorted.length < beatsPerBar * 2) return 0;

  // A change has to land within a quarter of a beat to count as "on" that beat.
  const tolerance = medianBeatInterval(sorted) * 0.25;
  if (tolerance <= 0) return 0;

  const votes = new Array<number>(beatsPerBar).fill(0);
  for (let i = 1; i < segments.length; i++) {
    const changeTime = segments[i].startSec;
    if (!Number.isFinite(changeTime)) continue;
    const index = nearestBeatIndex(sorted, changeTime);
    if (index < 0 || Math.abs(sorted[index] - changeTime) > tolerance) continue;
    votes[index % beatsPerBar] += 1;
  }

  let best = 0;
  for (let phase = 1; phase < beatsPerBar; phase++) {
    // Strict `>` keeps phase 0 on a tie, matching the previous assumption.
    if (votes[phase] > votes[best]) best = phase;
  }
  return votes[best] === 0 ? 0 : best;
}

/**
 * Re-snap section boundaries onto the current bar grid.
 *
 * Detection runs once, in the worker, against the default metre — the chroma it
 * reads is gone by the time the musician picks 3/4. Snapping is therefore done
 * here, on every render of the lane, so changing the metre reflows the section
 * boundaries onto the new bar lines instead of leaving them mid-bar.
 *
 * Boundaries stay monotonic and gap-free. A section whose two boundaries snap
 * onto the same downbeat has collapsed and is absorbed into its predecessor
 * rather than emitted with zero width.
 */
export function snapSections<T extends { startSec: number; endSec: number }>(
  sections: readonly T[],
  downbeats: readonly number[],
): T[] {
  if (sections.length === 0) return [];
  if (downbeats.length === 0) return sections.map((section) => ({ ...section }));

  const snapped: T[] = [];
  for (const section of sections) {
    const previous = snapped[snapped.length - 1];
    // The song's own start and end are not boundaries to be moved.
    const start = snapped.length === 0
      ? section.startSec
      : snapToDownbeat(downbeats, section.startSec);
    const end = section.endSec;

    if (previous && start <= previous.startSec) {
      // The *previous* section is the one the new bar grid squeezed to nothing.
      // This one survives, so it inherits the slot and keeps the earlier start.
      // Dropping this section instead would keep a sliver's label and discard a
      // real section, which is the wrong way round.
      snapped[snapped.length - 1] = { ...section, startSec: previous.startSec, endSec: end };
      continue;
    }
    if (end - start <= 0) {
      // This section is the one that collapsed; hand its span back.
      if (previous) previous.endSec = Math.max(previous.endSec, end);
      continue;
    }
    if (previous) previous.endSec = start;
    snapped.push({ ...section, startSec: start, endSec: end });
  }
  return snapped;
}
