/// <reference lib="webworker" />
// Off-main-thread audio analysis: key, tempo/beats, and a full-vocabulary
// chord progression. essentia.js does feature extraction; chroma extraction
// and the Viterbi chord decoder live in extract-chroma / classify-chords.

import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";

import { classifyChords } from "./classify-chords";
import { estimateTuning, extractChromaFrames } from "./extract-chroma";
import type { AnalysisResult, AnalyzeRequest, WorkerResponse } from "../types";

let essentia: Essentia | null = null;

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

function tryDelete(vector: { delete?: () => void } | undefined): void {
  try {
    vector?.delete?.();
  } catch {
    // Best-effort; the worker is torn down after each analysis anyway.
  }
}

function analyze(
  essentiaInstance: Essentia,
  channelData: Float32Array,
  sampleRate: number,
  durationSec: number,
): AnalysisResult {
  post({ type: "progress", stage: "extracting", progress: 0.02 });

  const audioVector = essentiaInstance.arrayToVector(channelData);

  // Musical key.
  const keyOut = essentiaInstance.KeyExtractor(audioVector);
  post({ type: "progress", stage: "extracting", progress: 0.1 });

  // Tuning reference, so slightly detuned recordings land in the right bins.
  const tuningHz = estimateTuning(essentiaInstance, audioVector);
  post({ type: "progress", stage: "extracting", progress: 0.18 });

  // Tempo + beat grid. "degara" is considerably faster than the default
  // "multifeature" method with equivalent beat placement for our purposes
  // (its confidence output is always 0, which we don't use anyway).
  const rhythm = essentiaInstance.RhythmExtractor2013(audioVector, 208, "degara", 40);
  const beats = Array.from(essentiaInstance.vectorToArray(rhythm.ticks)) as number[];
  const bpm = rhythm.bpm;
  tryDelete(rhythm.ticks);
  tryDelete(audioVector);
  post({ type: "progress", stage: "chords", progress: 0.3 });

  // Per-frame whitened chroma, then Viterbi chord decoding.
  const chroma = extractChromaFrames(essentiaInstance, channelData, sampleRate, tuningHz, (fraction) =>
    post({ type: "progress", stage: "chords", progress: 0.3 + 0.65 * fraction }),
  );
  const segments = classifyChords({
    frames: chroma.frames,
    frameTimes: chroma.frameTimes,
    beats,
    durationSec,
  });
  post({ type: "progress", stage: "done", progress: 1 });

  return {
    durationSec,
    sampleRate,
    bpm: Math.round(bpm * 10) / 10,
    key: { tonic: keyOut.key, scale: keyOut.scale, strength: keyOut.strength },
    beats,
    segments,
  };
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { channelData, sampleRate, durationSec } = event.data;
  try {
    if (!essentia) essentia = new Essentia(EssentiaWASM);
    const result = analyze(essentia, channelData, sampleRate, durationSec);
    post({ type: "result", result });
  } catch (error) {
    console.error("[chord-finder] Analysis failed:", error);
    const detail = error instanceof Error ? error.message : String(error);
    post({
      type: "error",
      message: `Analysis failed while processing the audio (${detail}). Try re-importing the file.`,
    });
  }
};
