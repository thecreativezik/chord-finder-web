// Fixtures shared by the provenance tests. Kept out of the test file so the
// scenarios read as scenarios rather than as object literals.

import { CHORD_ENGINE, chordDecoderParams } from "../src/analysis/provenance";
import type { ChordSegment, DerivedChords, Provenance } from "../src/types";

export type { DerivedChords, Provenance };

/** The shape `App` used to consult instead of the artifact. */
export interface StemKindLike {
  id: string;
  kind: string;
}

function segment(symbol: string, startSec: number, endSec: number): ChordSegment {
  return { symbol, startSec, endSec, confidence: 0.8 };
}

export function bassRootChords(source: string, durationMs = 1_200): DerivedChords {
  return {
    segments: [segment("C", 0, 2), segment("F", 2, 4)],
    provenance: {
      module: "chords",
      source,
      engine: CHORD_ENGINE,
      params: chordDecoderParams("bass-root", 440),
      startedAt: 1_000,
      durationMs,
    },
  };
}

export function harmonyChords(source: string, durationMs = 1_200): DerivedChords {
  return {
    segments: [segment("Cmaj7", 0, 2), segment("Am7", 2, 4)],
    provenance: {
      module: "beats-and-chords",
      source,
      engine: CHORD_ENGINE,
      params: chordDecoderParams("harmony", 440),
      startedAt: 1_000,
      durationMs,
    },
  };
}
