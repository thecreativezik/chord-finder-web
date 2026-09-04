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

export type AnalysisStatus =
  | { state: "idle" }
  | { state: "loading"; stage: AnalysisStage; progress: number; fileName: string }
  | { state: "ready"; fileName: string; audioUrl: string; result: AnalysisResult }
  | { state: "error"; message: string };

// ── Worker message protocol ───────────────────────────────────────────
export interface AnalyzeRequest {
  channelData: Float32Array; // mono PCM, resampled to 44.1kHz
  sampleRate: number; // always 44100 (see use-analysis)
  durationSec: number;
}

export type WorkerResponse =
  | { type: "progress"; stage: AnalysisStage; progress: number }
  | { type: "result"; result: AnalysisResult }
  | { type: "error"; message: string };
