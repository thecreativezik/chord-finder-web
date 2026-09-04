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

export interface AnalysisResult {
  durationSec: number;
  sampleRate: number;
  bpm: number;
  key: KeyResult;
  beats: number[]; // beat onset times in seconds
  waveform: number[]; // normalized peak envelope for the session timeline
  segments: ChordSegment[];
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
