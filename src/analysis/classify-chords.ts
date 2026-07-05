// Beat-synchronous chord recognition with Viterbi decoding.
//
// Pipeline: per-frame chroma -> averaged into beat (or fixed) windows ->
// per-window template scores -> Viterbi decode across the whole song ->
// merged segments.
//
// The Viterbi pass is what makes this robust on real recordings: instead of
// picking the best template per window independently (which flickers between
// C / C6 / Cmaj7 as the melody moves), it finds the single most likely chord
// *sequence*, where staying on the current chord is free and switching costs
// a penalty. A transient melody note then has to out-argue the switch penalty
// before the label changes, which it can't unless the harmony really moved.

import { buildTemplates } from "./chord-templates";
import type { ChordSegment } from "../types";

export const NO_CHORD = "N.C.";

// Essentia's HPCP bin 0 corresponds to the reference frequency (440Hz = A),
// so HPCP index i maps to pitch class (i + 9) mod 12. We re-index to C = 0.
const HPCP_BIN0_PITCH_CLASS = 9;

// Below this average bin energy we treat the window as silence / no chord.
const SILENCE_ENERGY = 1e-4;

// ── Viterbi parameters (tuned against scripts/eval-pipeline.ts) ──────────
// Emission sharpening: cosine scores live in a narrow band (~0.7–1.0), so we
// raise them to a power to make "slightly better" matches actually count.
const EMISSION_GAMMA = 14;
// Log-cost of changing chords between adjacent windows. Higher = smoother.
const SWITCH_PENALTY = 2.2;
// Per-quality-rank multiplicative handicap so complex chords (maj9, dim7…)
// must beat the simple reading by a margin, not a hair.
const COMPLEXITY_WEIGHT = 0.004;
// Score assigned to the N.C. state; a real chord must beat this to win.
const NC_SCORE = 0.62;
// Windows shorter-lived than this (after merging) get folded into a neighbour.
const MIN_SEGMENT_SEC = 0.25;

/** Re-index an essentia HPCP frame (bin 0 = A) to pitch-class order (index 0 = C). */
export function hpcpToPitchClass(hpcp: Float32Array | number[]): Float32Array {
  const out = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    const pc = (i + HPCP_BIN0_PITCH_CLASS) % 12;
    out[pc] = hpcp[i] ?? 0;
  }
  return out;
}

interface AnalysisWindow {
  start: number;
  end: number;
}

export interface ClassifyInput {
  frames: Float32Array[]; // C-indexed chroma per frame
  frameTimes: number[]; // start time (sec) of each frame
  beats: number[]; // beat times (sec); may be empty
  durationSec: number;
}

/** Build analysis windows from beats, falling back to fixed slices. */
function buildWindows(beats: number[], durationSec: number): AnalysisWindow[] {
  const sorted = beats.filter((b) => b >= 0 && b <= durationSec).sort((a, b) => a - b);
  if (sorted.length >= 2) {
    const windows: AnalysisWindow[] = [];
    if (sorted[0] > 0.1) windows.push({ start: 0, end: sorted[0] });
    for (let i = 0; i < sorted.length - 1; i++) {
      windows.push({ start: sorted[i], end: sorted[i + 1] });
    }
    const last = sorted[sorted.length - 1];
    if (durationSec - last > 0.1) windows.push({ start: last, end: durationSec });
    return windows;
  }
  // Fallback: fixed 0.5s windows.
  const windows: AnalysisWindow[] = [];
  for (let t = 0; t < durationSec; t += 0.5) {
    windows.push({ start: t, end: Math.min(t + 0.5, durationSec) });
  }
  return windows;
}

/** Mean chroma over the frames whose start time falls inside [start, end). */
function averageChroma(
  frames: Float32Array[],
  frameTimes: number[],
  start: number,
  end: number,
): Float32Array {
  const sum = new Float32Array(12);
  let count = 0;
  for (let i = 0; i < frames.length; i++) {
    const t = frameTimes[i];
    if (t < start) continue;
    if (t >= end) break;
    const frame = frames[i];
    for (let b = 0; b < 12; b++) sum[b] += frame[b];
    count++;
  }
  if (count > 0) {
    for (let b = 0; b < 12; b++) sum[b] /= count;
  }
  return sum;
}

/**
 * Cosine score of every template against one window's chroma.
 * Returns raw scores in [0, 1]; the caller applies priors.
 */
function templateScores(chroma: Float32Array, scores: Float32Array): boolean {
  let energy = 0;
  for (const value of chroma) energy += value;
  if (energy < SILENCE_ENERGY) return false; // silent window

  let sumSq = 0;
  for (const value of chroma) sumSq += value * value;
  const norm = Math.sqrt(sumSq) || 1;

  const templates = buildTemplates();
  for (let s = 0; s < templates.length; s++) {
    const vector = templates[s].vector;
    let dot = 0;
    for (let b = 0; b < 12; b++) dot += (chroma[b] / norm) * vector[b];
    scores[s] = dot;
  }
  return true;
}

export function classifyChords(input: ClassifyInput): ChordSegment[] {
  const templates = buildTemplates();
  const windows = buildWindows(input.beats, input.durationSec);
  const windowCount = windows.length;
  const stateCount = templates.length + 1; // + N.C.
  const ncState = templates.length;
  if (windowCount === 0) return [];

  // Per-window raw cosine scores (kept for confidence reporting) and
  // log-emissions with the complexity prior applied.
  const rawScores: Float32Array[] = [];
  const logEmissions: Float32Array[] = [];
  const scratch = new Float32Array(templates.length);

  for (const window of windows) {
    const chroma = averageChroma(input.frames, input.frameTimes, window.start, window.end);
    const raw = new Float32Array(stateCount);
    const logs = new Float32Array(stateCount);
    const hasSound = templateScores(chroma, scratch);

    for (let s = 0; s < templates.length; s++) {
      const cosine = hasSound ? scratch[s] : 0;
      raw[s] = cosine;
      const handicapped = cosine * (1 - COMPLEXITY_WEIGHT * templates[s].complexity);
      logs[s] = EMISSION_GAMMA * Math.log(Math.max(handicapped, 1e-6));
    }
    raw[ncState] = 0;
    logs[ncState] = EMISSION_GAMMA * Math.log(hasSound ? NC_SCORE : 0.95);

    rawScores.push(raw);
    logEmissions.push(logs);
  }

  // Viterbi. Transitions: stay = free, switch = -SWITCH_PENALTY from the best
  // previous state (uniform over targets, so only the max matters).
  let prevDp = new Float64Array(stateCount);
  let nextDp = new Float64Array(stateCount);
  const backPointers: Int32Array[] = [];
  prevDp.set(logEmissions[0]);

  for (let w = 1; w < windowCount; w++) {
    let bestPrevState = 0;
    let bestPrevScore = -Infinity;
    for (let s = 0; s < stateCount; s++) {
      if (prevDp[s] > bestPrevScore) {
        bestPrevScore = prevDp[s];
        bestPrevState = s;
      }
    }
    const pointers = new Int32Array(stateCount);
    const emissions = logEmissions[w];
    for (let s = 0; s < stateCount; s++) {
      const stay = prevDp[s];
      const switchIn = bestPrevScore - SWITCH_PENALTY;
      if (stay >= switchIn || bestPrevState === s) {
        nextDp[s] = stay + emissions[s];
        pointers[s] = s;
      } else {
        nextDp[s] = switchIn + emissions[s];
        pointers[s] = bestPrevState;
      }
    }
    backPointers.push(pointers);
    [prevDp, nextDp] = [nextDp, prevDp];
  }

  // Backtrack.
  const path = new Int32Array(windowCount);
  let endState = 0;
  let endScore = -Infinity;
  for (let s = 0; s < stateCount; s++) {
    if (prevDp[s] > endScore) {
      endScore = prevDp[s];
      endState = s;
    }
  }
  path[windowCount - 1] = endState;
  for (let w = windowCount - 2; w >= 0; w--) {
    path[w] = backPointers[w][path[w + 1]];
  }

  // Merge the decoded path into segments, then fold away ultra-short ones.
  const merged: ChordSegment[] = [];
  for (let w = 0; w < windowCount; w++) {
    const state = path[w];
    const symbol = state === ncState ? NO_CHORD : templates[state].symbol;
    const confidence = state === ncState ? 0 : rawScores[w][state];
    const last = merged[merged.length - 1];
    if (last && last.symbol === symbol) {
      last.endSec = windows[w].end;
      last.confidence = Math.max(last.confidence, confidence);
    } else {
      merged.push({ symbol, startSec: windows[w].start, endSec: windows[w].end, confidence });
    }
  }

  const cleaned: ChordSegment[] = [];
  for (const seg of merged) {
    const last = cleaned[cleaned.length - 1];
    if (last && seg.endSec - seg.startSec < MIN_SEGMENT_SEC) {
      last.endSec = seg.endSec;
      continue;
    }
    if (last && last.symbol === seg.symbol) {
      last.endSec = seg.endSec;
      last.confidence = Math.max(last.confidence, seg.confidence);
      continue;
    }
    cleaned.push({ ...seg });
  }
  return cleaned;
}
