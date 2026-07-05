// Minimal ambient typings for the essentia.js ES builds, which ship without
// usable type declarations for the deep `dist/*` entry points we import in the
// worker. We type only the surface we actually use.

declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: unknown;
}

declare module "essentia.js/dist/essentia.js-core.es.js" {
  export interface EssentiaVector {
    size(): number;
    get(index: number): EssentiaVector;
    delete?(): void;
  }

  export interface KeyResultRaw {
    key: string;
    scale: string;
    strength: number;
  }
  export interface RhythmResultRaw {
    bpm: number;
    confidence: number;
    ticks: EssentiaVector;
  }
  export interface FrameResultRaw {
    frame: EssentiaVector;
  }
  export interface SpectrumResultRaw {
    spectrum: EssentiaVector;
  }
  export interface SpectralPeaksResultRaw {
    frequencies: EssentiaVector;
    magnitudes: EssentiaVector;
  }
  export interface HpcpResultRaw {
    hpcp: EssentiaVector;
  }
  export interface TuningFrequencyResultRaw {
    tuningFrequency: EssentiaVector;
  }
  export interface SpectralWhiteningResultRaw {
    magnitudes: EssentiaVector;
  }

  export default class Essentia {
    constructor(wasmModule: unknown, isDebug?: boolean);
    arrayToVector(input: Float32Array): EssentiaVector;
    vectorToArray(input: EssentiaVector): Float32Array;
    FrameGenerator(audio: Float32Array, frameSize?: number, hopSize?: number): EssentiaVector;
    KeyExtractor(audio: EssentiaVector, ...args: unknown[]): KeyResultRaw;
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): RhythmResultRaw;
    Windowing(
      frame: EssentiaVector,
      normalized?: boolean,
      size?: number,
      type?: string,
    ): FrameResultRaw;
    Spectrum(frame: EssentiaVector, size?: number): SpectrumResultRaw;
    SpectralPeaks(
      spectrum: EssentiaVector,
      magnitudeThreshold?: number,
      maxFrequency?: number,
      maxPeaks?: number,
      minFrequency?: number,
      orderBy?: string,
      sampleRate?: number,
    ): SpectralPeaksResultRaw;
    HPCP(
      frequencies: EssentiaVector,
      magnitudes: EssentiaVector,
      ...args: unknown[]
    ): HpcpResultRaw;
    TuningFrequencyExtractor(
      signal: EssentiaVector | unknown,
      frameSize?: number,
      hopSize?: number,
    ): TuningFrequencyResultRaw;
    SpectralWhitening(
      spectrum: EssentiaVector,
      frequencies: EssentiaVector,
      magnitudes: EssentiaVector,
      maxFrequency?: number,
      sampleRate?: number,
    ): SpectralWhiteningResultRaw;
  }
}
