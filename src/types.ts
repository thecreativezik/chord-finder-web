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
  channelData: Float32Array;
  sampleRate: number;
  durationSec: number;
  beats: number[];
}

export type AnalyzeRequest = FullAnalyzeRequest | ChordAnalyzeRequest;

export type WorkerResponse =
  | { type: "progress"; stage: AnalysisStage; progress: number }
  | { type: "result"; result: AnalysisResult }
  | { type: "chord-result"; segments: ChordSegment[] }
  | { type: "error"; message: string };
