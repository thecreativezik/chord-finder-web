// Tempo as a set of regions rather than one number.
//
// `AnalysisResult.bpm` is RhythmExtractor2013's answer to "what single number
// best fits this whole file". For a practice tool that is the wrong question: a
// rallentando ending, a double-time bridge, or live drums drifting across three
// minutes all get averaged into a figure the musician never actually plays at.
//
// No new analysis is needed. `AnalysisResult.beats` is every beat onset in
// seconds, so instantaneous tempo is already implicit in the spacing. This
// module reads it out, and — like the beat map — is derived on the client and
// never stored, because two copies of the beat times drift apart.
//
// `bpm` itself is left exactly as it is. It is what `scripts/eval-pipeline.ts`
// compares against and the analysis engine is shared verbatim with the macOS
// app; redefining a field the eval reads, to add a display feature, is not a
// trade worth making.

import { medianBeatInterval, normalizeBeats } from "./beat-map";
import type { TempoRegion, TimeSignature } from "../types";

/** Beats either side of the centre in the median filter. */
const SMOOTHING_RADIUS = 2;
/** Two tempi within this fraction of each other are the same tempo. */
const TEMPO_TOLERANCE = 0.02;
/** Shorter than this and it is a tracking artifact, not a section at a new tempo. */
const MIN_REGION_BARS = 4;
/** Below this many beats there is not enough spacing to read a tempo at all. */
const MIN_BEATS = 8;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Median rather than mean, and this is the load-bearing choice in the module.
 * Beat trackers drop and double individual beats; a mean smears one dropped
 * beat across every value in its window, while a median ignores it outright.
 */
function medianFilter(values: readonly number[], radius: number): number[] {
  if (values.length === 0) return [];
  return values.map((_, index) => {
    const from = Math.max(0, index - radius);
    const to = Math.min(values.length - 1, index + radius);
    return median(values.slice(from, to + 1));
  });
}

/**
 * Fold a tempo by powers of two until it sits within a factor of √2 of the
 * reference, so a tracker that flips to half or double time reads as the same
 * tempo rather than as a tempo change.
 *
 * This deliberately also erases a *genuine* doubling. From beat times alone the
 * two are indistinguishable — a band playing twice as fast and a tracker
 * emitting beats twice as fast produce identical spacing — and reporting a
 * change we cannot substantiate is worse than reporting none.
 */
function foldToOctaveOf(value: number, reference: number): number {
  if (!(value > 0) || !(reference > 0)) return value;
  let folded = value;
  const upper = Math.SQRT2;
  const lower = 1 / Math.SQRT2;
  // Bounded: a factor of 2^8 covers any tempo either engine can report.
  for (let step = 0; step < 8 && folded / reference >= upper; step += 1) folded /= 2;
  for (let step = 0; step < 8 && folded / reference < lower; step += 1) folded *= 2;
  return folded;
}

function sameTempo(a: number, b: number): boolean {
  const reference = Math.max(a, b);
  return reference > 0 && Math.abs(a - b) / reference <= TEMPO_TOLERANCE;
}

interface Draft {
  startBeat: number;
  endBeat: number; // exclusive, in beat-interval indices
  tempi: number[];
}

function draftToRegion(draft: Draft, beats: readonly number[]): TempoRegion {
  return {
    bpm: Math.round(median(draft.tempi) * 10) / 10,
    startSec: beats[draft.startBeat],
    // `endBeat` indexes intervals, so the region closes on the beat after the
    // last interval it covers.
    endSec: beats[Math.min(draft.endBeat + 1, beats.length - 1)],
    startBeat: draft.startBeat,
    endBeat: draft.endBeat + 1,
  };
}

/**
 * Contiguous regions of roughly constant tempo.
 *
 * Returns `[]` when the song holds one tempo throughout — the same contract the
 * arrangement lane keeps. The caller then reports the scalar it already has.
 * The failure mode is "no new information", never "wrong new information".
 */
export function detectTempoRegions(
  rawBeats: readonly number[],
  timeSignature: TimeSignature,
): TempoRegion[] {
  const beats = normalizeBeats(rawBeats);
  if (beats.length < MIN_BEATS) return [];

  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i += 1) intervals.push(beats[i] - beats[i - 1]);

  const instantaneous = intervals.map((interval) => (interval > 0 ? 60 / interval : 0));
  if (instantaneous.some((bpm) => !Number.isFinite(bpm) || bpm <= 0)) return [];

  const smoothed = medianFilter(instantaneous, SMOOTHING_RADIUS);
  const referenceInterval = medianBeatInterval(beats);
  if (!(referenceInterval > 0)) return [];
  const reference = 60 / referenceInterval;
  const folded = smoothed.map((bpm) => foldToOctaveOf(bpm, reference));

  // Grow regions while the running median stays within tolerance.
  const drafts: Draft[] = [];
  for (let index = 0; index < folded.length; index += 1) {
    const current = drafts[drafts.length - 1];
    if (current && sameTempo(median(current.tempi), folded[index])) {
      current.tempi.push(folded[index]);
      current.endBeat = index;
      continue;
    }
    drafts.push({ startBeat: index, endBeat: index, tempi: [folded[index]] });
  }

  const beatsPerBar = Math.max(1, Math.round(timeSignature.beatsPerBar));
  const minBeats = MIN_REGION_BARS * beatsPerBar;
  mergeShortRegions(drafts, minBeats);
  mergeAdjacentEqualRegions(drafts);

  if (drafts.length < 2) return [];
  return drafts.map((draft) => draftToRegion(draft, beats));
}

/**
 * Fold each too-short region into whichever neighbour it is closer to in
 * tempo — not always the earlier one. Folding in a single direction is exactly
 * what left a stray four-second "section A" at the head of every fixture in the
 * arrangement lane, so the same trap is closed up front here.
 */
function mergeShortRegions(drafts: Draft[], minBeats: number): void {
  let changed = true;
  while (changed && drafts.length > 1) {
    changed = false;
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index];
      if (draft.tempi.length >= minBeats) continue;

      const previous = index > 0 ? drafts[index - 1] : null;
      const next = index < drafts.length - 1 ? drafts[index + 1] : null;
      if (!previous && !next) break;

      const own = median(draft.tempi);
      const previousGap = previous ? Math.abs(median(previous.tempi) - own) : Number.POSITIVE_INFINITY;
      const nextGap = next ? Math.abs(median(next.tempi) - own) : Number.POSITIVE_INFINITY;
      const target = previousGap <= nextGap ? previous : next;
      if (!target) break;

      target.tempi.push(...draft.tempi);
      target.startBeat = Math.min(target.startBeat, draft.startBeat);
      target.endBeat = Math.max(target.endBeat, draft.endBeat);
      drafts.splice(index, 1);
      changed = true;
      break;
    }
  }
}

/** A gradual drift can split into neighbours that are not actually different. */
function mergeAdjacentEqualRegions(drafts: Draft[]): void {
  for (let index = drafts.length - 1; index > 0; index -= 1) {
    const previous = drafts[index - 1];
    const current = drafts[index];
    if (!sameTempo(median(previous.tempi), median(current.tempi))) continue;
    previous.tempi.push(...current.tempi);
    previous.endBeat = current.endBeat;
    drafts.splice(index, 1);
  }
}

/** "118–124 BPM" for a lane, or "120 BPM" when there is only one figure. */
export function formatTempoRange(regions: readonly TempoRegion[], fallbackBpm: number): string {
  if (regions.length === 0) return `${fallbackBpm} BPM`;
  const values = regions.map((region) => region.bpm);
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low} BPM` : `${low}–${high} BPM`;
}
