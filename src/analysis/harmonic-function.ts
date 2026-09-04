import { Chord, Note } from "tonal";

import { NO_CHORD } from "./classify-chords";

export interface HarmonicFunction {
  degree: string;
  solfa: string;
  shortLabel: string;
  spokenLabel: string;
}

const CHROMATIC_DEGREES: ReadonlyArray<readonly [string, string]> = [
  ["1", "Do"],
  ["♭2", "Ra"],
  ["2", "Re"],
  ["♭3", "Me"],
  ["3", "Mi"],
  ["4", "Fa"],
  ["♯4", "Fi"],
  ["5", "Sol"],
  ["♭6", "Le"],
  ["6", "La"],
  ["♭7", "Te"],
  ["7", "Ti"],
];

const EMPTY: HarmonicFunction = {
  degree: "—",
  solfa: "—",
  shortLabel: "—",
  spokenLabel: "No harmonic function",
};

/**
 * Return the chord root's tonic-relative number and movable-Do solfège.
 * Chromatic roots remain useful rather than disappearing (for example ♭3 · Me).
 */
export function getHarmonicFunction(
  chordSymbol: string,
  keyTonic: string,
): HarmonicFunction {
  if (!chordSymbol || chordSymbol === NO_CHORD) return EMPTY;
  const tonicPc = Note.chroma(keyTonic);
  const chord = Chord.get(chordSymbol);
  const rootPc = chord.tonic ? Note.chroma(chord.tonic) : null;
  if (typeof tonicPc !== "number" || typeof rootPc !== "number") return EMPTY;

  const offset = (rootPc - tonicPc + 12) % 12;
  const [degree, solfa] = CHROMATIC_DEGREES[offset];
  return {
    degree,
    solfa,
    shortLabel: `${degree} · ${solfa}`,
    spokenLabel: `Scale degree ${degree}, ${solfa}`,
  };
}

