// The chord vocabulary used for detection and keyboard mapping.
//
// We deliberately cover the full common chord set (triads, sixths, sevenths,
// half/fully-diminished, suspended, augmented, ninths) rather than just
// major/minor triads. Pitch classes and names come from `tonal` so we never
// hand-roll music theory.

import { Chord, Note } from "tonal";

// Pitch-class index 0..11, C = 0. Sharps for display consistency.
export const PITCH_CLASS_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

// Quality suffixes appended to a root note to form a tonal chord symbol,
// ordered from simplest to most complex (used to break ties toward simpler
// chords when match scores are equal).
export const CHORD_SUFFIXES = [
  "", // major triad
  "m", // minor triad
  "sus4",
  "sus2",
  "dim",
  "aug",
  "6",
  "m6",
  "7",
  "maj7",
  "m7",
  "m7b5",
  "dim7",
  "9",
  "maj9",
  "m9",
] as const;

export interface ChordEntry {
  symbol: string; // tonal symbol, e.g. "C#m7"
  rootPc: number; // root pitch class 0..11
  pitchClasses: number[]; // absolute pitch classes (C = 0)
  complexity: number; // suffix rank (0 = major triad … higher = more exotic)
}

/** Absolute pitch classes (0..11, C = 0) for a chord symbol, or [] if unknown. */
export function chordPitchClasses(symbol: string): number[] {
  const chord = Chord.get(symbol);
  if (chord.empty) return [];
  const pcs: number[] = [];
  for (const note of chord.notes) {
    const pc = Note.chroma(note);
    if (typeof pc === "number" && !pcs.includes(pc)) pcs.push(pc);
  }
  return pcs;
}

/** Every (root × quality) chord we attempt to detect. */
export function buildChordVocabulary(): ChordEntry[] {
  const entries: ChordEntry[] = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    const rootName = PITCH_CLASS_NAMES[rootPc];
    CHORD_SUFFIXES.forEach((suffix, complexity) => {
      const symbol = rootName + suffix;
      const pitchClasses = chordPitchClasses(symbol);
      if (pitchClasses.length === 0) return;
      entries.push({ symbol, rootPc, pitchClasses, complexity });
    });
  }
  return entries;
}
