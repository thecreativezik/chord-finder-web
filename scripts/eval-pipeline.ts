// Offline evaluation harness for the analysis pipeline.
//
// Generates a synthetic "song" with a known chord progression, runs the same
// essentia.js pipeline the worker uses, and reports per-stage timings plus
// chord detection accuracy. Run with: npx tsx scripts/eval-pipeline.ts
//
// This exists so classifier changes can be measured, not guessed at. Everything
// stochastic in the synthetic song is seeded (see eval-synth.ts), so two runs of
// the same commit report the same accuracy and any movement is a real change.
//
// Environment:
//   EVAL_SEED=1   seed for the synthetic song's drums and noise floor
//   EVAL_LOOPS=8  times the progression repeats (8 ≈ 2 minutes at 120 BPM)
//   EVAL_HARD=1   approximate a real mix: detuning, inversions, melody, drums

/* global console, process, setTimeout, performance */

import EssentiaDefault from "essentia.js/dist/essentia.js-core.es.js";
import * as wasmModule from "essentia.js/dist/essentia-wasm.es.js";

import { classifyChords } from "../src/analysis/classify-chords";
import { estimateTuning, extractChromaFrames } from "../src/analysis/extract-chroma";
import { SAMPLE_RATE, synthesize } from "./eval-synth";

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

/**
 * Read an integer from the environment. Rejects garbage loudly rather than
 * coercing it to NaN and silently evaluating a different song than asked for.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

const DEFAULT_SEED = 1;

function time<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  console.log(`  ${label}: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  return result;
}

async function main(): Promise<void> {
  const seed = envInt("EVAL_SEED", DEFAULT_SEED);
  const loops = envInt("EVAL_LOOPS", 8);
  const hard = process.env.EVAL_HARD === "1";

  const { audio, truth } = synthesize({ loops, hard, seed });
  const durationSec = audio.length / SAMPLE_RATE;
  // Print the configuration with the result: an accuracy figure only means
  // something alongside the song it scored.
  console.log(`Config: seed=${seed}, loops=${loops}, mode=${hard ? "hard" : "clean"}`);
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
