// Maps a detected chord symbol to the notes (names + pitch classes) used to
// mark the keyboard diagram.

import { Chord, Note } from "tonal";

import { NO_CHORD } from "./classify-chords";
import { PITCH_CLASS_NAMES } from "./chord-vocabulary";

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

/** Transpose the root of one of our generated chord symbols by semitones. */
export function transposeChordSymbol(symbol: string, semitones: number): string {
  if (!symbol || symbol === NO_CHORD) return symbol;
  const match = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(symbol);
  if (!match) return symbol;
  const transposePitch = (pitch: string): string => {
    const pitchClass = Note.chroma(pitch);
    if (typeof pitchClass !== "number") return pitch;
    const nextPc = (pitchClass + (semitones % 12) + 12) % 12;
    return PITCH_CLASS_NAMES[nextPc];
  };
  const bass = match[3] ? `/${transposePitch(match[3])}` : "";
  return `${transposePitch(match[1])}${match[2]}${bass}`;
}
