// Chroma (HPCP) extraction tuned for chord recognition.
//
// Shared by the analysis worker and the offline eval harness so that measured
// accuracy always reflects exactly what ships. Improvements over the naive
// pipeline: tuning-frequency estimation (so detuned recordings don't smear
// across bins), spectral whitening before HPCP (flattens timbre so chord tones
// dominate percussion/vocals), harmonic weighting, and JS-side framing so the
// WASM heap never holds more than one frame at a time.

import type Essentia from "essentia.js/dist/essentia.js-core.es.js";

import { hpcpToPitchClass } from "./classify-chords";

const FRAME_SIZE = 4096;
const HOP_SIZE = 2048;
const MIN_FREQ = 40;
const MAX_FREQ = 5000;
const MAX_PEAKS = 60;

// Sane bounds for tuning estimation; outside this we assume the estimator
// latched onto something that isn't the tuning reference.
const TUNING_MIN = 415;
const TUNING_MAX = 466;

export interface ChromaFrames {
  frames: Float32Array[]; // C-indexed 12-bin chroma per frame
  frameTimes: number[]; // frame start times (sec)
  tuningHz: number; // estimated reference frequency used for HPCP
}

interface Deletable {
  delete?: () => void;
}

function tryDelete(vector: Deletable | undefined): void {
  try {
    vector?.delete?.();
  } catch {
    // Best-effort cleanup; the worker is torn down after each analysis.
  }
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Estimate the recording's tuning reference (Hz), defaulting to 440. */
export function estimateTuning(essentia: Essentia, audioVector: unknown): number {
  try {
    const out = essentia.TuningFrequencyExtractor(audioVector, FRAME_SIZE, HOP_SIZE);
    const perFrame: number[] = Array.from(essentia.vectorToArray(out.tuningFrequency));
    tryDelete(out.tuningFrequency);
    const estimate = median(perFrame.filter((f) => f >= TUNING_MIN && f <= TUNING_MAX));
    if (Number.isFinite(estimate)) return estimate;
  } catch {
    // Fall through to concert pitch.
  }
  return 440;
}

/**
 * Per-frame whitened HPCP chroma for the whole signal.
 *
 * Frames are sliced in JS and copied into the WASM heap one at a time, so
 * memory stays flat regardless of song length (FrameGenerator materializes
 * every frame at once, which is where long songs used to blow up).
 */
export function extractChromaFrames(
  essentia: Essentia,
  channelData: Float32Array,
  sampleRate: number,
  tuningHz: number,
  onProgress?: (fraction: number) => void,
): ChromaFrames {
  const frames: Float32Array[] = [];
  const frameTimes: number[] = [];
  const frameCount = Math.max(1, Math.floor((channelData.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const paddedFrame = new Float32Array(FRAME_SIZE);

  for (let i = 0; i < frameCount; i++) {
    const start = i * HOP_SIZE;
    let frameData: Float32Array;
    if (start + FRAME_SIZE <= channelData.length) {
      frameData = channelData.subarray(start, start + FRAME_SIZE);
    } else {
      paddedFrame.fill(0);
      paddedFrame.set(channelData.subarray(start));
      frameData = paddedFrame;
    }

    const frameVector = essentia.arrayToVector(frameData);
    const windowed = essentia.Windowing(frameVector, true, FRAME_SIZE, "blackmanharris62");
    const spectrum = essentia.Spectrum(windowed.frame, FRAME_SIZE);
    const peaks = essentia.SpectralPeaks(
      spectrum.spectrum,
      0,
      MAX_FREQ,
      MAX_PEAKS,
      MIN_FREQ,
      "frequency",
      sampleRate,
    );
    // Whitening flattens the spectral envelope so strong-timbre sources
    // (drums, voice) stop drowning out the harmony.
    const whitened = essentia.SpectralWhitening(
      spectrum.spectrum,
      peaks.frequencies,
      peaks.magnitudes,
      MAX_FREQ,
      sampleRate,
    );
    const hpcp = essentia.HPCP(
      peaks.frequencies,
      whitened.magnitudes,
      true, // bandPreset
      500, // bandSplitFrequency
      4, // harmonics: fold upper partials back onto their fundamentals
      MAX_FREQ,
      false, // maxShifted
      MIN_FREQ,
      false, // nonLinear
      "unitMax",
      tuningHz,
      sampleRate,
      12,
      "cosine",
      1, // windowSize in semitones (values below 1 are rejected by essentia)
    );

    frames.push(hpcpToPitchClass(essentia.vectorToArray(hpcp.hpcp)));
    frameTimes.push(start / sampleRate);

    tryDelete(frameVector);
    tryDelete(windowed.frame);
    tryDelete(spectrum.spectrum);
    tryDelete(peaks.frequencies);
    tryDelete(peaks.magnitudes);
    tryDelete(whitened.magnitudes);
    tryDelete(hpcp.hpcp);

    if (onProgress && i % 64 === 0) onProgress(i / frameCount);
  }

  return { frames, frameTimes, tuningHz };
}
