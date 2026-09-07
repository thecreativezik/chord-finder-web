/// <reference lib="webworker" />
// Off-main-thread audio analysis: key, tempo/beats, and a full-vocabulary
// chord progression. essentia.js does feature extraction; chroma extraction
// and the Viterbi chord decoder live in extract-chroma / classify-chords.

import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";

import { DEFAULT_TIME_SIGNATURE } from "./beat-map";
import { classifyChords } from "./classify-chords";
import { classifyBassRoots } from "./classify-bass-roots";
import { detectSections } from "./detect-sections";
import { estimateTuning, extractChromaFrames } from "./extract-chroma";
import {
  CHORD_ENGINE,
  chordDecoderParams,
  createProvenance,
  ORIGINAL_MIX_SOURCE,
} from "./provenance";
import type {
  AnalysisResult,
  AnalyzeRequest,
  ChordAnalysisMode,
  ChordSegment,
  Provenance,
  WorkerResponse,
} from "../types";

let essentia: Essentia | null = null;

const WAVEFORM_BUCKETS = 720;

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

/** Build a compact, normalized peak envelope for the editor timeline. */
function buildWaveform(channelData: Float32Array): number[] {
  const bucketCount = Math.min(WAVEFORM_BUCKETS, Math.max(1, channelData.length));
  const waveform = new Array<number>(bucketCount);
  let globalPeak = 0;

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = Math.floor((bucket * channelData.length) / bucketCount);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * channelData.length) / bucketCount));
    let peak = 0;
    for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(channelData[i]));
    waveform[bucket] = peak;
    globalPeak = Math.max(globalPeak, peak);
  }

  if (globalPeak > 0) {
    for (let i = 0; i < waveform.length; i++) {
      // A gentle curve keeps quieter phrases legible without flattening dynamics.
      waveform[i] = Math.sqrt(waveform[i] / globalPeak);
    }
  }
  return waveform;
}

function analyze(
  essentiaInstance: Essentia,
  channelData: Float32Array,
  sampleRate: number,
  durationSec: number,
): AnalysisResult {
  const startedAt = Date.now();
  post({ type: "progress", stage: "extracting", progress: 0.02 });

  const audioVector = essentiaInstance.arrayToVector(channelData);
  const waveform = buildWaveform(channelData);

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

  // Arrangement, read off the chroma the chord decoder just consumed rather
  // than from a second pass over the audio. Boundaries come back unquantised on
  // purpose: the bar grid depends on a metre the musician can still change, and
  // the chroma is gone by then, so quantisation is the client's job (see
  // `snapSections`). One owner for bar alignment, not two.
  const timeSignature = DEFAULT_TIME_SIGNATURE;
  const sections = detectSections({
    frames: chroma.frames,
    frameTimes: chroma.frameTimes,
    beats,
    durationSec,
    timeSignature,
  });
  post({ type: "progress", stage: "done", progress: 1 });

  return {
    durationSec,
    sampleRate,
    bpm: Math.round(bpm * 10) / 10,
    key: { tonic: keyOut.key, scale: keyOut.scale, strength: keyOut.strength },
    beats,
    timeSignature,
    waveform,
    segments,
    sections,
    // The arrangement is read off the same chroma as the harmony in this one
    // run, so it shares this record rather than carrying a second copy.
    provenance: createProvenance({
      module: "beats-and-chords",
      source: ORIGINAL_MIX_SOURCE,
      engine: CHORD_ENGINE,
      params: chordDecoderParams("harmony", tuningHz),
      startedAt,
    }),
  };
}

function analyzeChords(
  essentiaInstance: Essentia,
  channelData: Float32Array,
  sampleRate: number,
  durationSec: number,
  beats: number[],
  analysisMode: ChordAnalysisMode,
  source: string,
): { segments: ChordSegment[]; provenance: Provenance } {
  const startedAt = Date.now();
  post({ type: "progress", stage: "chords", progress: 0.05 });
  const audioVector = essentiaInstance.arrayToVector(channelData);
  const tuningHz = estimateTuning(essentiaInstance, audioVector);
  tryDelete(audioVector);
  const chroma = extractChromaFrames(essentiaInstance, channelData, sampleRate, tuningHz, (fraction) =>
    post({ type: "progress", stage: "chords", progress: 0.08 + 0.9 * fraction }),
  );
  const classify = analysisMode === "bass-root" ? classifyBassRoots : classifyChords;
  const segments = classify({
    frames: chroma.frames,
    frameTimes: chroma.frameTimes,
    beats,
    durationSec,
  });
  post({ type: "progress", stage: "done", progress: 1 });
  return {
    segments,
    provenance: createProvenance({
      module: "chords",
      source,
      engine: CHORD_ENGINE,
      params: chordDecoderParams(analysisMode, tuningHz),
      startedAt,
    }),
  };
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const request = event.data;
  const { channelData, sampleRate, durationSec } = request;
  try {
    if (!essentia) essentia = new Essentia(EssentiaWASM);
    if (request.mode === "chords") {
      const { segments, provenance } = analyzeChords(
        essentia,
        channelData,
        sampleRate,
        durationSec,
        request.beats,
        request.analysisMode,
        request.source,
      );
      post({ type: "chord-result", segments, provenance });
      return;
    }
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
