import { describe, expect, it } from "vitest";

import { DEFAULT_TIME_SIGNATURE } from "../src/analysis/beat-map";
import { detectTempoRegions, formatTempoRange } from "../src/analysis/tempo-map";

/** Beat times for `count` beats at `bpm`, starting at `startSec`. */
function beatsAt(bpm: number, count: number, startSec = 0): number[] {
  const interval = 60 / bpm;
  return Array.from({ length: count }, (_, index) => startSec + index * interval);
}

/** Concatenate tempo stretches into one continuous beat grid. */
function beatGrid(stretches: ReadonlyArray<{ bpm: number; beats: number }>): number[] {
  const times: number[] = [];
  let cursor = 0;
  for (const stretch of stretches) {
    const interval = 60 / stretch.bpm;
    for (let index = 0; index < stretch.beats; index += 1) {
      times.push(cursor);
      cursor += interval;
    }
  }
  return times;
}

describe("honest silence", () => {
  it("reports nothing for a song that holds one tempo", () => {
    expect(detectTempoRegions(beatsAt(120, 240), DEFAULT_TIME_SIGNATURE)).toEqual([]);
  });

  it("reports nothing when there are too few beats to read spacing", () => {
    expect(detectTempoRegions(beatsAt(120, 4), DEFAULT_TIME_SIGNATURE)).toEqual([]);
    expect(detectTempoRegions([], DEFAULT_TIME_SIGNATURE)).toEqual([]);
  });

  it("survives a beat list that is unsorted, duplicated and partly invalid", () => {
    const beats = [1, 0.5, Number.NaN, 0.5, 0, -3, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    expect(() => detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE)).not.toThrow();
  });

  it("is not fooled by a single dropped beat", () => {
    // A tracker misses one beat in the middle: that interval reads as 60 BPM in
    // a 120 BPM song. A mean would smear it; the median filter ignores it.
    const beats = beatsAt(120, 240);
    beats.splice(120, 1);
    expect(detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE)).toEqual([]);
  });
});

describe("a real tempo change", () => {
  const beats = beatGrid([
    { bpm: 120, beats: 128 },
    { bpm: 90, beats: 96 },
  ]);
  const regions = detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE);

  it("is reported as two regions at the right tempi", () => {
    expect(regions).toHaveLength(2);
    expect(regions[0].bpm).toBeCloseTo(120, 0);
    expect(regions[1].bpm).toBeCloseTo(90, 0);
  });

  it("places the boundary within one beat of the truth", () => {
    const truth = beats[128];
    expect(Math.abs(regions[1].startSec - truth)).toBeLessThanOrEqual(60 / 90);
  });

  it("covers the song end to end with no gap between regions", () => {
    expect(regions[0].startSec).toBeCloseTo(beats[0], 6);
    expect(regions[0].endSec).toBeCloseTo(regions[1].startSec, 6);
    expect(regions[1].endSec).toBeCloseTo(beats[beats.length - 1], 6);
  });

  it("reads out as a range", () => {
    expect(formatTempoRange(regions, 108)).toMatch(/^9\d–1[12]\d BPM$/);
  });
});

describe("half-time tracking", () => {
  it("collapses a half-time flip rather than calling it a tempo change", () => {
    // The tracker locks to half time for a sparse middle section. The band did
    // not change tempo, and from beat spacing alone the two are
    // indistinguishable — so this must not be reported as a change.
    const beats = beatGrid([
      { bpm: 120, beats: 96 },
      { bpm: 60, beats: 48 },
      { bpm: 120, beats: 96 },
    ]);
    expect(detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE)).toEqual([]);
  });
});

describe("short regions", () => {
  it("folds a two-bar blip into a neighbour instead of reporting it", () => {
    const beats = beatGrid([
      { bpm: 120, beats: 128 },
      { bpm: 138, beats: 8 }, // two bars of 4/4
      { bpm: 120, beats: 128 },
    ]);
    expect(detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE)).toEqual([]);
  });

  it("folds a blip forwards when the later neighbour is the closer tempo", () => {
    // 120 → (8 beats of 104) → 100. All three differ by more than the
    // tolerance, so the blip really does become its own region; 104 is 4 BPM
    // from 100 and 16 from 120, so it belongs with what follows it. Folding
    // backwards unconditionally would put those two bars in the 120 region and
    // move the reported boundary two bars late.
    const beats = beatGrid([
      { bpm: 120, beats: 128 },
      { bpm: 104, beats: 8 },
      { bpm: 100, beats: 128 },
    ]);
    const regions = detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE);
    expect(regions).toHaveLength(2);

    const blipStart = beats[128];
    const blipEnd = beats[136];
    const boundary = regions[1].startSec;
    expect(Math.abs(boundary - blipStart)).toBeLessThan(Math.abs(boundary - blipEnd));
  });

  it("scales the minimum length with the metre", () => {
    // Four bars of 7/8 is 28 beats, so a 20-beat stretch is too short there and
    // long enough in 2/4, where four bars is 8 beats.
    const beats = beatGrid([
      { bpm: 120, beats: 128 },
      { bpm: 96, beats: 20 },
      { bpm: 120, beats: 128 },
    ]);
    expect(detectTempoRegions(beats, { beatsPerBar: 7, beatUnit: 8 })).toEqual([]);
    expect(detectTempoRegions(beats, { beatsPerBar: 2, beatUnit: 4 }).length).toBeGreaterThan(1);
  });
});

describe("formatTempoRange", () => {
  it("falls back to the scalar when there is no lane", () => {
    expect(formatTempoRange([], 118.5)).toBe("118.5 BPM");
  });

  it("collapses a range whose ends agree", () => {
    const region = { startSec: 0, endSec: 1, startBeat: 0, endBeat: 1, bpm: 120 };
    expect(formatTempoRange([region, { ...region }], 120)).toBe("120 BPM");
  });
});

describe("budget", () => {
  it("stays trivial for a 30-minute set", () => {
    const beats = beatsAt(120, 3_600);
    const started = performance.now();
    detectTempoRegions(beats, DEFAULT_TIME_SIGNATURE);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
