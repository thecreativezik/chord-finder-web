// Deterministic synthetic-audio generator for the offline evaluation harness.
//
// Split out of eval-pipeline.ts for two reasons: the generator can be exercised
// without loading the essentia WASM runtime, and its randomness is seeded
// rather than ambient. An accuracy figure is only comparable between two runs
// if the audio it scored was identical in both, and the drums and noise floor
// here are the only things that vary.

import { chordPitchClasses } from "../src/analysis/chord-vocabulary";

export const SAMPLE_RATE = 44100;

/** Tempo of the synthesized song, in beats per minute. */
export const BPM = 120;

export interface ProgressionStep {
  symbol: string;
  beats: number;
}

// A realistic pop progression in C major, 120 BPM, with quality variety.
export const PROGRESSION: ProgressionStep[] = [
  { symbol: "C", beats: 4 },
  { symbol: "G", beats: 4 },
  { symbol: "Am", beats: 4 },
  { symbol: "F", beats: 4 },
  { symbol: "C", beats: 4 },
  { symbol: "Am", beats: 4 },
  { symbol: "Dm7", beats: 4 },
  { symbol: "G7", beats: 4 },
];

export interface TruthStep {
  symbol: string;
  startSec: number;
  endSec: number;
}

export interface SynthOptions {
  /** Times PROGRESSION repeats. 8 ≈ 2 minutes at 120 BPM. */
  loops: number;
  /**
   * Approximate a real mix: detuned reference, chord inversions, a vibrato
   * melody line, drums (kick/snare/hats), and broadband noise.
   */
  hard: boolean;
  /** Seed for every stochastic element — the drums and the noise floor. */
  seed: number;
}

/**
 * mulberry32. Small, widely used, and adequate for shaping noise; the property
 * that matters here is that the same seed yields the same sequence, not
 * cryptographic quality.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthesize a chord as a sum of harmonics per note, with a bass root octave. */
export function synthesize({ loops, hard, seed }: SynthOptions): {
  audio: Float32Array;
  truth: TruthStep[];
} {
  if (!Number.isInteger(loops) || loops < 1) {
    throw new Error(`loops must be a positive integer, got ${loops}`);
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`seed must be an integer, got ${seed}`);
  }

  const random = createRng(seed);
  const detuneRef = hard ? 443 : 440; // global tuning offset (~12 cents)
  const noteFreq = (midi: number): number => detuneRef * Math.pow(2, (midi - 69) / 12);

  const beatSec = 60 / BPM;
  const steps: TruthStep[] = [];
  let t = 0;
  for (let loop = 0; loop < loops; loop++) {
    for (const step of PROGRESSION) {
      const dur = step.beats * beatSec;
      steps.push({ symbol: step.symbol, startSec: t, endSec: t + dur });
      t += dur;
    }
  }
  const totalSec = t;
  const audio = new Float32Array(Math.ceil(totalSec * SAMPLE_RATE));

  let stepIndex = 0;
  for (const step of steps) {
    const pcs = chordPitchClasses(step.symbol);
    const rootPc = pcs[0];
    const start = Math.floor(step.startSec * SAMPLE_RATE);
    const end = Math.min(audio.length, Math.floor(step.endSec * SAMPLE_RATE));
    // Voice notes around octave 4 (MIDI 60..71) + bass root an octave below.
    // In hard mode, rotate inversions so the lowest voiced note isn't always
    // the root, like a real pianist would.
    const freqs: { f: number; gain: number }[] = [];
    const inversion = hard ? stepIndex % Math.max(1, pcs.length) : 0;
    pcs.forEach((pc, noteIndex) => {
      let midi = 60 + ((pc - 0 + 12) % 12);
      if (noteIndex < inversion) midi += 12;
      freqs.push({ f: noteFreq(midi), gain: 0.22 });
    });
    const bassMidi = 48 + rootPc;
    freqs.push({ f: noteFreq(bassMidi), gain: 0.3 });

    for (const { f, gain } of freqs) {
      // Harmonics with rolloff to look more like a real instrument.
      const harmonicCount = hard ? 6 : 3;
      for (let h = 1; h <= harmonicCount; h++) {
        const w = (2 * Math.PI * f * h) / SAMPLE_RATE;
        const g = gain / (h * h);
        // Slow amplitude decay per chord hit, like a struck piano note.
        for (let i = start; i < end; i++) {
          const envelope = hard ? Math.exp(-1.2 * ((i - start) / SAMPLE_RATE)) : 1;
          audio[i] += g * envelope * Math.sin(w * (i - start));
        }
      }
    }

    if (hard) {
      // Vibrato melody line an octave up, walking chord tones (like a vocal).
      const melodyPc = pcs[(stepIndex + 1) % pcs.length];
      const mf = noteFreq(72 + melodyPc);
      for (let i = start; i < end; i++) {
        const tSec = (i - start) / SAMPLE_RATE;
        const vibrato = 1 + 0.008 * Math.sin(2 * Math.PI * 5.5 * tSec);
        audio[i] += 0.28 * Math.sin(2 * Math.PI * mf * vibrato * tSec);
      }
    }

    // Percussion per beat: hard mode gets kick/snare/hats, else a simple click.
    const beatsInStep = Math.round((step.endSec - step.startSec) / beatSec);
    for (let b = 0; b < beatsInStep; b++) {
      const beatStart = start + Math.floor(b * beatSec * SAMPLE_RATE);
      if (!hard) {
        const clickLen = Math.floor(0.02 * SAMPLE_RATE);
        for (let i = 0; i < clickLen && beatStart + i < audio.length; i++) {
          audio[beatStart + i] += 0.5 * (random() * 2 - 1) * (1 - i / clickLen);
        }
        continue;
      }
      // Kick: descending sine sweep on every beat.
      const kickLen = Math.floor(0.09 * SAMPLE_RATE);
      for (let i = 0; i < kickLen && beatStart + i < audio.length; i++) {
        const tSec = i / SAMPLE_RATE;
        const sweep = 120 * Math.exp(-18 * tSec) + 45;
        audio[beatStart + i] += 0.5 * Math.exp(-22 * tSec) * Math.sin(2 * Math.PI * sweep * tSec);
      }
      // Snare: noise burst on beats 2 and 4.
      if (b % 2 === 1) {
        const snareLen = Math.floor(0.08 * SAMPLE_RATE);
        for (let i = 0; i < snareLen && beatStart + i < audio.length; i++) {
          audio[beatStart + i] += 0.35 * (random() * 2 - 1) * Math.exp(-40 * (i / SAMPLE_RATE));
        }
      }
      // Hats: short bright noise on eighth notes.
      for (const half of [0, 0.5]) {
        const hatStart = beatStart + Math.floor(half * beatSec * SAMPLE_RATE);
        const hatLen = Math.floor(0.02 * SAMPLE_RATE);
        for (let i = 0; i < hatLen && hatStart + i < audio.length; i++) {
          audio[hatStart + i] += 0.12 * (random() * 2 - 1) * Math.exp(-90 * (i / SAMPLE_RATE));
        }
      }
    }
    stepIndex++;
  }

  if (hard) {
    // Broadband noise floor over the whole mix.
    for (let i = 0; i < audio.length; i++) {
      audio[i] += 0.02 * (random() * 2 - 1);
    }
  }
  // Normalize to avoid clipping.
  let peak = 0;
  for (const v of audio) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.99) {
    const s = 0.99 / peak;
    for (let i = 0; i < audio.length; i++) audio[i] *= s;
  }
  return { audio, truth: steps };
}
