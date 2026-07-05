// Offline evaluation harness for the analysis pipeline.
//
// Generates a synthetic "song" with a known chord progression, runs the same
// essentia.js pipeline the worker uses, and reports per-stage timings plus
// chord detection accuracy. Run with: npx tsx scripts/eval-pipeline.ts
//
// This exists so classifier changes can be measured, not guessed at.

/* global console, process, setTimeout, performance */

import EssentiaDefault from "essentia.js/dist/essentia.js-core.es.js";
import * as wasmModule from "essentia.js/dist/essentia-wasm.es.js";

import { classifyChords } from "../src/analysis/classify-chords";
import { chordPitchClasses } from "../src/analysis/chord-vocabulary";
import { estimateTuning, extractChromaFrames } from "../src/analysis/extract-chroma";

// Vite resolves the ES build's exports directly; under Node/tsx the emscripten
// glue takes its CJS path and replaces module.exports with the raw Module, so
// resolve both shapes and wait for the WASM runtime to finish initializing.
const Essentia =
  typeof EssentiaDefault === "function"
    ? EssentiaDefault
    : (EssentiaDefault as { default: typeof EssentiaDefault }).default;

const wasmAny = wasmModule as unknown as Record<string, unknown> & {
  EssentiaWASM?: { EssentiaJS?: unknown };
};
const EssentiaWASM = (wasmAny.EssentiaWASM ?? wasmAny.default ?? wasmAny) as {
  EssentiaJS?: unknown;
};

async function waitForWasm(): Promise<void> {
  const deadline = Date.now() + 20000;
  while (typeof EssentiaWASM.EssentiaJS === "undefined") {
    if (Date.now() > deadline) throw new Error("essentia WASM runtime never initialized");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const SAMPLE_RATE = 44100;

interface ProgressionStep {
  symbol: string;
  beats: number;
}

// A realistic pop progression in C major, 120 BPM, with quality variety.
const BPM = 120;
const PROGRESSION: ProgressionStep[] = [
  { symbol: "C", beats: 4 },
  { symbol: "G", beats: 4 },
  { symbol: "Am", beats: 4 },
  { symbol: "F", beats: 4 },
  { symbol: "C", beats: 4 },
  { symbol: "Am", beats: 4 },
  { symbol: "Dm7", beats: 4 },
  { symbol: "G7", beats: 4 },
];
const LOOPS = Number(process.env.EVAL_LOOPS ?? 8); // 8 ≈ 2 minutes at 120 BPM

// EVAL_HARD=1 approximates a real mix: detuned reference, chord inversions,
// a vibrato melody line, drums (kick/snare/hats), and broadband noise.
const HARD = process.env.EVAL_HARD === "1";
const DETUNE_REF = HARD ? 443 : 440; // global tuning offset (~12 cents)

function noteFreq(midi: number): number {
  return DETUNE_REF * Math.pow(2, (midi - 69) / 12);
}

/** Synthesize a chord as a sum of harmonics per note, with a bass root octave. */
function synthesize(): { audio: Float32Array; truth: { symbol: string; startSec: number; endSec: number }[] } {
  const beatSec = 60 / BPM;
  const steps: { symbol: string; startSec: number; endSec: number }[] = [];
  let t = 0;
  for (let loop = 0; loop < LOOPS; loop++) {
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
    // In HARD mode, rotate inversions so the lowest voiced note isn't always
    // the root, like a real pianist would.
    const freqs: { f: number; gain: number }[] = [];
    const inversion = HARD ? stepIndex % Math.max(1, pcs.length) : 0;
    pcs.forEach((pc, noteIndex) => {
      let midi = 60 + ((pc - 0 + 12) % 12);
      if (noteIndex < inversion) midi += 12;
      freqs.push({ f: noteFreq(midi), gain: 0.22 });
    });
    const bassMidi = 48 + rootPc;
    freqs.push({ f: noteFreq(bassMidi), gain: 0.3 });

    for (const { f, gain } of freqs) {
      // Harmonics with rolloff to look more like a real instrument.
      const harmonicCount = HARD ? 6 : 3;
      for (let h = 1; h <= harmonicCount; h++) {
        const w = (2 * Math.PI * f * h) / SAMPLE_RATE;
        const g = gain / (h * h);
        // Slow amplitude decay per chord hit, like a struck piano note.
        for (let i = start; i < end; i++) {
          const envelope = HARD ? Math.exp(-1.2 * ((i - start) / SAMPLE_RATE)) : 1;
          audio[i] += g * envelope * Math.sin(w * (i - start));
        }
      }
    }

    if (HARD) {
      // Vibrato melody line an octave up, walking chord tones (like a vocal).
      const melodyPc = pcs[(stepIndex + 1) % pcs.length];
      const mf = noteFreq(72 + melodyPc);
      for (let i = start; i < end; i++) {
        const t = (i - start) / SAMPLE_RATE;
        const vibrato = 1 + 0.008 * Math.sin(2 * Math.PI * 5.5 * t);
        audio[i] += 0.28 * Math.sin(2 * Math.PI * mf * vibrato * t);
      }
    }

    // Percussion per beat: HARD gets kick/snare/hats, else a simple click.
    const beatsInStep = Math.round((step.endSec - step.startSec) / beatSec);
    for (let b = 0; b < beatsInStep; b++) {
      const beatStart = start + Math.floor(b * beatSec * SAMPLE_RATE);
      if (!HARD) {
        const clickLen = Math.floor(0.02 * SAMPLE_RATE);
        for (let i = 0; i < clickLen && beatStart + i < audio.length; i++) {
          audio[beatStart + i] += 0.5 * (Math.random() * 2 - 1) * (1 - i / clickLen);
        }
        continue;
      }
      // Kick: descending sine sweep on every beat.
      const kickLen = Math.floor(0.09 * SAMPLE_RATE);
      for (let i = 0; i < kickLen && beatStart + i < audio.length; i++) {
        const t = i / SAMPLE_RATE;
        const sweep = 120 * Math.exp(-18 * t) + 45;
        audio[beatStart + i] += 0.5 * Math.exp(-22 * t) * Math.sin(2 * Math.PI * sweep * t);
      }
      // Snare: noise burst on beats 2 and 4.
      if (b % 2 === 1) {
        const snareLen = Math.floor(0.08 * SAMPLE_RATE);
        for (let i = 0; i < snareLen && beatStart + i < audio.length; i++) {
          audio[beatStart + i] += 0.35 * (Math.random() * 2 - 1) * Math.exp(-40 * (i / SAMPLE_RATE));
        }
      }
      // Hats: short bright noise on eighth notes.
      for (const half of [0, 0.5]) {
        const hatStart = beatStart + Math.floor(half * beatSec * SAMPLE_RATE);
        const hatLen = Math.floor(0.02 * SAMPLE_RATE);
        for (let i = 0; i < hatLen && hatStart + i < audio.length; i++) {
          audio[hatStart + i] += 0.12 * (Math.random() * 2 - 1) * Math.exp(-90 * (i / SAMPLE_RATE));
        }
      }
    }
    stepIndex++;
  }

  if (HARD) {
    // Broadband noise floor over the whole mix.
    for (let i = 0; i < audio.length; i++) {
      audio[i] += 0.02 * (Math.random() * 2 - 1);
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

function time<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  console.log(`  ${label}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  return result;
}

async function main(): Promise<void> {
  const { audio, truth } = synthesize();
  const durationSec = audio.length / SAMPLE_RATE;
  console.log(`Synth song: ${durationSec.toFixed(1)}s, ${truth.length} chord steps`);

  await waitForWasm();
  const essentia = new Essentia(EssentiaWASM);
  console.log(`essentia ${essentia.version}`);

  const audioVector = time("arrayToVector", () => essentia.arrayToVector(audio));

  const keyOut = time("KeyExtractor", () => essentia.KeyExtractor(audioVector));
  console.log(`  -> key: ${keyOut.key} ${keyOut.scale} (strength ${keyOut.strength.toFixed(2)})`);

  const tuningHz = time("estimateTuning", () => estimateTuning(essentia, audioVector));
  console.log(`  -> tuning: ${tuningHz.toFixed(1)} Hz`);

  const rhythm = time("RhythmExtractor2013 (degara)", () =>
    essentia.RhythmExtractor2013(audioVector, 208, "degara", 40),
  );
  const beats: number[] = Array.from(essentia.vectorToArray(rhythm.ticks));
  console.log(`  -> bpm: ${rhythm.bpm.toFixed(1)}, beats: ${beats.length}`);

  const chroma = time("extractChromaFrames (whitened HPCP)", () =>
    extractChromaFrames(essentia, audio, SAMPLE_RATE, tuningHz),
  );

  const segments = time("classifyChords (Viterbi)", () =>
    classifyChords({ frames: chroma.frames, frameTimes: chroma.frameTimes, beats, durationSec }),
  );

  // Score: for each 0.25s probe point, does the detected symbol match truth?
  let hits = 0;
  let probes = 0;
  for (let t = 0.5; t < durationSec - 0.5; t += 0.25) {
    const expected = truth.find((s) => t >= s.startSec && t < s.endSec)?.symbol;
    const actual = segments.find((s) => t >= s.startSec && t < s.endSec)?.symbol;
    if (!expected) continue;
    probes++;
    if (expected === actual) hits++;
  }
  console.log(`\nAccuracy: ${((100 * hits) / probes).toFixed(1)}% (${hits}/${probes} probe points)`);
  console.log(`Segments (first 16):`);
  for (const seg of segments.slice(0, 16)) {
    console.log(
      `  ${seg.startSec.toFixed(2)}–${seg.endSec.toFixed(2)}  ${seg.symbol}  (conf ${seg.confidence.toFixed(2)})`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
