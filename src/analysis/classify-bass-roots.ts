// Beat-synchronous root-note recognition for isolated bass stems.
//
// A bass line is monophonic evidence, so feeding it to the full chord-template
// decoder invents chord qualities that are not present in the signal. This
// classifier deliberately emits only pitch-class names (C, C#, ...), using the
// master song's beat grid and a light Viterbi smoother to avoid note flicker.

import type { ChordSegment } from "../types";
import {
  NO_CHORD,
  averageChromaForWindow,
  buildAnalysisWindows,
  type ClassifyInput,
} from "./classify-chords";
import { PITCH_CLASS_NAMES } from "./chord-vocabulary";

const PITCH_CLASS_COUNT = 12;
const NC_STATE = PITCH_CLASS_COUNT;
const STATE_COUNT = PITCH_CLASS_COUNT + 1;

// Chroma from Essentia is unit-normalized per frame. A truly silent frame is
// still all-zero, while even a quiet but pitched bass remains above this value.
const SILENCE_ENERGY = 1e-4;
const EMISSION_GAMMA = 9;
const SWITCH_PENALTY = 1.45;
const NC_SOUND_SCORE = 0.035;
const MIN_SEGMENT_SEC = 0.25;

interface WindowEvidence {
  probabilities: Float32Array;
  hasSound: boolean;
}

function rootEvidence(chroma: Float32Array): WindowEvidence {
  let energy = 0;
  for (const value of chroma) energy += Math.max(0, value);
  if (energy < SILENCE_ENERGY) {
    return { probabilities: new Float32Array(PITCH_CLASS_COUNT), hasSound: false };
  }

  const probabilities = new Float32Array(PITCH_CLASS_COUNT);
  for (let pitchClass = 0; pitchClass < PITCH_CLASS_COUNT; pitchClass++) {
    // The pitch itself carries nearly all of the decision. A small perfect-
    // fifth contribution helps when a bass tone's first strong overtone leaks
    // into the fifth bin without allowing that overtone to become the root.
    const fifth = (pitchClass + 7) % PITCH_CLASS_COUNT;
    probabilities[pitchClass] =
      (Math.max(0, chroma[pitchClass]) + 0.08 * Math.max(0, chroma[fifth])) / energy;
  }
  return { probabilities, hasSound: true };
}

function confidenceFor(probabilities: Float32Array, state: number): number {
  const best = probabilities[state] ?? 0;
  let runnerUp = 0;
  for (let i = 0; i < probabilities.length; i++) {
    if (i !== state) runnerUp = Math.max(runnerUp, probabilities[i]);
  }
  if (best <= 0) return 0;

  // Combine concentration with the margin over the next-best pitch. The
  // resulting value stays in [0,1] and is intentionally conservative.
  const concentration = Math.min(1, best * 2.5);
  const margin = Math.max(0, (best - runnerUp) / best);
  return Math.min(1, 0.35 * concentration + 0.65 * margin);
}

/** Decode simple bass pitch roots on the canonical master beat windows. */
export function classifyBassRoots(input: ClassifyInput): ChordSegment[] {
  const windows = buildAnalysisWindows(input.beats, input.durationSec);
  if (windows.length === 0) return [];

  const evidence: WindowEvidence[] = [];
  const emissions: Float32Array[] = [];

  for (const window of windows) {
    const chroma = averageChromaForWindow(
      input.frames,
      input.frameTimes,
      window.start,
      window.end,
    );
    const current = rootEvidence(chroma);
    const logs = new Float32Array(STATE_COUNT);

    for (let state = 0; state < PITCH_CLASS_COUNT; state++) {
      logs[state] = EMISSION_GAMMA * Math.log(Math.max(current.probabilities[state], 1e-6));
    }
    logs[NC_STATE] = EMISSION_GAMMA * Math.log(current.hasSound ? NC_SOUND_SCORE : 0.95);
    evidence.push(current);
    emissions.push(logs);
  }

  // The same stay-vs-switch Viterbi structure used by the chord classifier,
  // with a lighter penalty so genuine walking-bass notes can still move.
  let previous = new Float64Array(STATE_COUNT);
  let next = new Float64Array(STATE_COUNT);
  const backPointers: Int32Array[] = [];
  previous.set(emissions[0]);

  for (let windowIndex = 1; windowIndex < windows.length; windowIndex++) {
    let bestPreviousState = 0;
    let bestPreviousScore = -Infinity;
    for (let state = 0; state < STATE_COUNT; state++) {
      if (previous[state] > bestPreviousScore) {
        bestPreviousScore = previous[state];
        bestPreviousState = state;
      }
    }

    const pointers = new Int32Array(STATE_COUNT);
    for (let state = 0; state < STATE_COUNT; state++) {
      const stay = previous[state];
      const switchIn = bestPreviousScore - SWITCH_PENALTY;
      if (stay >= switchIn || bestPreviousState === state) {
        next[state] = stay + emissions[windowIndex][state];
        pointers[state] = state;
      } else {
        next[state] = switchIn + emissions[windowIndex][state];
        pointers[state] = bestPreviousState;
      }
    }
    backPointers.push(pointers);
    [previous, next] = [next, previous];
  }

  const path = new Int32Array(windows.length);
  let finalState = 0;
  let finalScore = -Infinity;
  for (let state = 0; state < STATE_COUNT; state++) {
    if (previous[state] > finalScore) {
      finalScore = previous[state];
      finalState = state;
    }
  }
  path[windows.length - 1] = finalState;
  for (let index = windows.length - 2; index >= 0; index--) {
    path[index] = backPointers[index][path[index + 1]];
  }

  const merged: ChordSegment[] = [];
  for (let index = 0; index < windows.length; index++) {
    const state = path[index];
    const symbol = state === NC_STATE ? NO_CHORD : PITCH_CLASS_NAMES[state];
    const confidence = state === NC_STATE ? 0 : confidenceFor(evidence[index].probabilities, state);
    const last = merged[merged.length - 1];
    if (last && last.symbol === symbol) {
      last.endSec = windows[index].end;
      last.confidence = Math.max(last.confidence, confidence);
    } else {
      merged.push({
        symbol,
        startSec: windows[index].start,
        endSec: windows[index].end,
        confidence,
      });
    }
  }

  // Fold ultra-short detections into the previous region, then merge again if
  // that joins two equal roots. This mirrors the full chord pipeline.
  const cleaned: ChordSegment[] = [];
  for (const segment of merged) {
    const last = cleaned[cleaned.length - 1];
    if (last && segment.endSec - segment.startSec < MIN_SEGMENT_SEC) {
      last.endSec = segment.endSec;
      continue;
    }
    if (last && last.symbol === segment.symbol) {
      last.endSec = segment.endSec;
      last.confidence = Math.max(last.confidence, segment.confidence);
      continue;
    }
    cleaned.push({ ...segment });
  }
  return cleaned;
}
