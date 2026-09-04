import { describe, expect, it } from "vitest";

import { getChordNotes, transposeChordSymbol } from "../src/analysis/chord-notes";
import { NO_CHORD } from "../src/analysis/classify-chords";
import { getHarmonicFunction } from "../src/analysis/harmonic-function";

describe("getHarmonicFunction", () => {
  it.each([
    ["D", "D", "1", "Do"],
    ["Em7", "D", "2", "Re"],
    ["Gmaj7", "D", "4", "Fa"],
    ["Bm", "D", "6", "La"],
    ["F", "D", "♭3", "Me"],
    ["G#dim", "D", "♯4", "Fi"],
  ])("maps %s in %s to %s · %s", (chord, tonic, degree, solfa) => {
    expect(getHarmonicFunction(chord, tonic)).toMatchObject({
      degree,
      solfa,
      shortLabel: `${degree} · ${solfa}`,
    });
  });

  it("returns an empty function for silence and unparseable symbols", () => {
    expect(getHarmonicFunction(NO_CHORD, "D").shortLabel).toBe("—");
    expect(getHarmonicFunction("not-a-chord", "D").shortLabel).toBe("—");
  });
});

describe("transposeChordSymbol", () => {
  it("preserves chord quality while transposing the root", () => {
    expect(transposeChordSymbol("Dmaj9", 3)).toBe("Fmaj9");
    expect(transposeChordSymbol("Bm7", -2)).toBe("Am7");
  });

  it("uses flat spelling for the root and slash bass when requested", () => {
    expect(transposeChordSymbol("A7/C#", 1, true)).toBe("Bb7/D");
    expect(transposeChordSymbol("F#m7/B", 4, true)).toBe("Bbm7/Eb");
  });

  it("keeps no-chord and unknown labels unchanged", () => {
    expect(transposeChordSymbol(NO_CHORD, 5, true)).toBe(NO_CHORD);
    expect(transposeChordSymbol("unknown", 5, true)).toBe("unknown");
  });
});

describe("getChordNotes", () => {
  it("uses player-friendly enharmonic labels when flats are preferred", () => {
    expect(getChordNotes("A#maj9", true).notes.map((note) => note.name)).toEqual([
      "Bb",
      "D",
      "F",
      "A",
      "C",
    ]);
  });
});
