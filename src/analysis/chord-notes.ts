// Maps a detected chord symbol to the notes (names + pitch classes) used to
// mark the keyboard diagram.

import { Chord, Note } from "tonal";

import { NO_CHORD } from "./classify-chords";

export interface ChordNote {
  name: string; // display name, e.g. "Bb"
  pc: number; // pitch class 0..11, C = 0
}

export interface ChordNotes {
  notes: ChordNote[]; // ascending chord-factor order (root first)
  pitchClasses: number[]; // 0..11, C = 0 (same order as notes)
  rootPc: number | null;
}

const EMPTY: ChordNotes = { notes: [], pitchClasses: [], rootPc: null };

export function getChordNotes(symbol: string): ChordNotes {
  if (!symbol || symbol === NO_CHORD) return EMPTY;
  const chord = Chord.get(symbol);
  if (chord.empty) return EMPTY;

  const notes: ChordNote[] = [];
  for (const name of chord.notes) {
    const pc = Note.chroma(name);
    if (typeof pc === "number" && !notes.some((n) => n.pc === pc)) {
      notes.push({ name, pc });
    }
  }
  const rootPc = chord.tonic ? (Note.chroma(chord.tonic) ?? null) : null;
  return { notes, pitchClasses: notes.map((n) => n.pc), rootPc };
}
