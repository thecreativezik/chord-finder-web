import { describe, expect, it } from "vitest";

import { classifyBassRoots } from "../src/analysis/classify-bass-roots";
import { NO_CHORD } from "../src/analysis/classify-chords";

function chroma(pitchClass?: number): Float32Array {
  const frame = new Float32Array(12);
  if (pitchClass !== undefined) frame[pitchClass] = 1;
  return frame;
}

describe("classifyBassRoots", () => {
  it("merges adjacent beat windows that carry the same root", () => {
    const segments = classifyBassRoots({
      frames: [chroma(0), chroma(0), chroma(0), chroma(0)],
      frameTimes: [0.1, 0.6, 1.1, 1.6],
      beats: [0, 0.5, 1, 1.5, 2],
      durationSec: 2,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ symbol: "C", startSec: 0, endSec: 2 });
    expect(segments[0].confidence).toBeGreaterThan(0.9);
  });

  it("recognizes a sustained root change without inventing chord quality", () => {
    const segments = classifyBassRoots({
      frames: [chroma(0), chroma(0), chroma(7), chroma(7)],
      frameTimes: [0.1, 0.6, 1.1, 1.6],
      beats: [0, 0.5, 1, 1.5, 2],
      durationSec: 2,
    });

    expect(segments.map(({ symbol, startSec, endSec }) => ({ symbol, startSec, endSec }))).toEqual([
      { symbol: "C", startSec: 0, endSec: 1 },
      { symbol: "G", startSec: 1, endSec: 2 },
    ]);
  });

  it("reports silent windows as no chord and merges them", () => {
    const segments = classifyBassRoots({
      frames: [chroma(), chroma(), chroma()],
      frameTimes: [0.1, 0.6, 1.1],
      beats: [],
      durationSec: 1.5,
    });

    expect(segments).toEqual([
      { symbol: NO_CHORD, startSec: 0, endSec: 1.5, confidence: 0 },
    ]);
  });
});
