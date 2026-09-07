// Shared types for the chord-analysis pipeline.

export interface KeyResult {
  tonic: string; // e.g. "C", "F#"
  scale: string; // "major" | "minor"
  strength: number; // 0..1 confidence from the key extractor
}

export interface ChordSegment {
  symbol: string; // e.g. "Cmaj7", "Am7", or "N.C." (no chord)
  startSec: number;
  endSec: number;
  confidence: number; // 0..1 (cosine match score)
  edited?: boolean; // true when a musician has replaced the detected symbol
}

/**
 * What produced a derived artifact.
 *
 * Narrow on purpose — see `analysis/provenance.ts`. The load-bearing field is
 * `params.decoder`: the app runs two different chord decoders and three
 * user-visible behaviours depend on knowing which one produced the segments
 * currently on screen.
 */
export interface Provenance {
  module: "beats-and-chords" | "chords" | "stem-separation";
  /** Where the artifact was derived from: "Original mix", or a stem's name. */
  source: string;
  /** Pinned engine identity, so a version or model bump is visible. */
  engine: string;
  /** Run parameters that change the output: decoder variant, tuning. */
  params?: Readonly<Record<string, string | number>>;
  startedAt: number; // epoch ms
  durationMs: number;
}

/**
 * A chord set together with the record of what decoded it. Stored as a pair so
 * that no consumer has to re-derive the decoder from the current selection —
 * the two disagree for a render after the source stem leaves the mixer.
 */
export interface DerivedChords {
  segments: ChordSegment[];
  provenance: Provenance;
}

/**
 * Metre in effect for the whole session. Detection is deliberately not
 * attempted — a wrong guess renumbers every bar on screen — so this is the
 * 4/4 default until the musician picks another metre.
 */
export interface TimeSignature {
  beatsPerBar: number; // numerator: 4 in 4/4
  beatUnit: number; // denominator: 4 in 4/4
}

/**
 * One detected beat placed in musical coordinates. Both counters are 1-based,
 * so `{ bar: 3, beatInBar: 1 }` is the downbeat of the third bar.
 *
 * Beat markers are always derived from `AnalysisResult.beats` via
 * `buildBeatMap`, never stored: two copies of the beat times drift apart.
 */
export interface BeatMarker {
  timeSec: number;
  bar: number;
  beatInBar: number;
}

/**
 * One stretch of roughly constant tempo, derived from the beat spacing.
 *
 * Always derived from `AnalysisResult.beats` via `detectTempoRegions`, never
 * stored — and `bpm` is left alone rather than redefined, because the eval
 * pipeline and the macOS app both read it.
 */
export interface TempoRegion {
  bpm: number;
  startSec: number;
  endSec: number;
  /** Index range into the normalized beat array, end exclusive. */
  startBeat: number;
  endBeat: number;
}

/**
 * One arrangement region — the repeat structure of the song rather than its
 * harmony. Labels are letters ("A", "B", "A2") because that is what a
 * self-similarity read actually supports; naming a region "Chorus" needs a
 * trained model we do not have. `edited` marks a musician's own name, matching
 * the contract ChordSegment already keeps.
 */
export interface SectionSegment {
  label: string;
  startSec: number;
  endSec: number;
  confidence: number; // 0..1 novelty strength at the opening boundary
  edited?: boolean;
}

export interface AnalysisResult {
  durationSec: number;
  sampleRate: number;
  bpm: number;
  key: KeyResult;
  beats: number[]; // beat onset times in seconds
  timeSignature: TimeSignature;
  waveform: number[]; // normalized peak envelope for the session timeline
  segments: ChordSegment[];
  sections: SectionSegment[]; // arrangement lane; empty when the song is too short to read
  provenance: Provenance; // what decoded this song's harmony and arrangement
}

export type AnalysisStage = "decoding" | "extracting" | "chords" | "done";

/**
 * Stem-aware decoding mode. Harmonic sources use the full chord vocabulary;
 * an isolated bass stem instead reports one pitch-class root per beat window.
 */
export type ChordAnalysisMode = "harmony" | "bass-root";

export type AnalysisStatus =
  | { state: "idle" }
  | { state: "loading"; stage: AnalysisStage; progress: number; fileName: string }
  | { state: "ready"; fileName: string; sourceFile: File; audioUrl: string; result: AnalysisResult }
  | { state: "error"; message: string };

// ── Worker message protocol ───────────────────────────────────────────
export interface FullAnalyzeRequest {
  mode: "full";
  channelData: Float32Array; // mono PCM, resampled to 44.1kHz
  sampleRate: number; // always 44100 (see use-analysis)
  durationSec: number;
}

export interface ChordAnalyzeRequest {
  mode: "chords";
  analysisMode: ChordAnalysisMode;
  /** Track name recorded in the returned provenance. */
  source: string;
  channelData: Float32Array;
  sampleRate: number;
  durationSec: number;
  beats: number[];
}

export type AnalyzeRequest = FullAnalyzeRequest | ChordAnalyzeRequest;

export type WorkerResponse =
  | { type: "progress"; stage: AnalysisStage; progress: number }
  | { type: "result"; result: AnalysisResult }
  | { type: "chord-result"; segments: ChordSegment[]; provenance: Provenance }
  | { type: "error"; message: string };
