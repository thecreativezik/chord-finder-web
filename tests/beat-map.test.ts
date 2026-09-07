import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIME_SIGNATURE,
  beatAtTime,
  buildBeatMap,
  downbeatTimes,
  estimateDownbeatPhase,
  formatBarBeat,
  formatTimeSignature,
  medianBeatInterval,
  nearestBeatIndex,
  normalizeBeats,
  parseTimeSignature,
  snapSections,
  snapToDownbeat,
} from "../src/analysis/beat-map";
import { buildClickPoints } from "../src/components/use-metronome";
import type { ChordSegment } from "../src/types";

/** Beat times at a steady 120 BPM. */
function steadyBeats(count: number, interval = 0.5): number[] {
  return Array.from({ length: count }, (_, index) => index * interval);
}

function chord(symbol: string, startSec: number, endSec: number): ChordSegment {
  return { symbol, startSec, endSec, confidence: 0.9 };
}

describe("normalizeBeats", () => {
  it("sorts, filters non-finite and negative times, and drops duplicates", () => {
    expect(normalizeBeats([2, 0.5, Number.NaN, -1, 0.5, Infinity, 1])).toEqual([0.5, 1, 2]);
  });

  it("keeps beats that are merely close together", () => {
    expect(normalizeBeats([0, 0.4, 0.8])).toEqual([0, 0.4, 0.8]);
  });
});

describe("medianBeatInterval", () => {
  it("is zero when there is no interval to measure", () => {
    expect(medianBeatInterval([])).toBe(0);
    expect(medianBeatInterval([1.5])).toBe(0);
  });

  it("ignores a single outlying gap", () => {
    expect(medianBeatInterval([0, 0.5, 1, 1.5, 9])).toBeCloseTo(0.5);
  });
});

describe("buildBeatMap", () => {
  it("numbers bars and beats from 1 in 4/4 with the downbeat on the first beat", () => {
    const map = buildBeatMap(steadyBeats(5), DEFAULT_TIME_SIGNATURE, 0);
    expect(map.map((marker) => marker.bar)).toEqual([1, 1, 1, 1, 2]);
    expect(map.map((marker) => marker.beatInBar)).toEqual([1, 2, 3, 4, 1]);
  });

  it("puts beats before the estimated downbeat in a pickup bar rather than bar 1", () => {
    const map = buildBeatMap(steadyBeats(6), DEFAULT_TIME_SIGNATURE, 1);
    expect(map[0]).toMatchObject({ bar: 0, beatInBar: 4 });
    expect(map[1]).toMatchObject({ bar: 1, beatInBar: 1 });
    expect(map[5]).toMatchObject({ bar: 2, beatInBar: 1 });
  });

  it("follows the chosen metre", () => {
    const map = buildBeatMap(steadyBeats(6), { beatsPerBar: 3, beatUnit: 4 }, 0);
    expect(map.map((marker) => marker.bar)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(downbeatTimes(map)).toEqual([0, 1.5]);
  });

  it("wraps an out-of-range phase instead of producing a negative beat", () => {
    const map = buildBeatMap(steadyBeats(4), DEFAULT_TIME_SIGNATURE, 5);
    expect(map[1]).toMatchObject({ bar: 1, beatInBar: 1 });
    expect(map.every((marker) => marker.beatInBar >= 1 && marker.beatInBar <= 4)).toBe(true);
  });

  it("survives an empty or unusable beat list", () => {
    expect(buildBeatMap([], DEFAULT_TIME_SIGNATURE, 0)).toEqual([]);
    expect(buildBeatMap([Number.NaN], DEFAULT_TIME_SIGNATURE, 0)).toEqual([]);
  });
});

describe("nearestBeatIndex and snapToDownbeat", () => {
  const beats = [0, 2, 4, 6];

  it("picks the closer neighbour on either side", () => {
    expect(nearestBeatIndex(beats, 0.9)).toBe(0);
    expect(nearestBeatIndex(beats, 1.1)).toBe(1);
    expect(nearestBeatIndex(beats, 99)).toBe(3);
    expect(nearestBeatIndex(beats, -5)).toBe(0);
  });

  it("resolves an exact midpoint downwards, deterministically", () => {
    expect(nearestBeatIndex(beats, 1)).toBe(0);
  });

  it("returns the time unchanged when there is nothing to snap to", () => {
    expect(nearestBeatIndex([], 4)).toBe(-1);
    expect(snapToDownbeat([], 4.2)).toBe(4.2);
  });

  it("snaps onto a bar line", () => {
    expect(snapToDownbeat([0, 2, 4], 3.4)).toBe(4);
  });
});

describe("beatAtTime", () => {
  const map = buildBeatMap(steadyBeats(8), DEFAULT_TIME_SIGNATURE, 0);

  it("reports the beat in effect, not the next one", () => {
    expect(beatAtTime(map, 1.75)).toMatchObject({ bar: 1, beatInBar: 4 });
    expect(beatAtTime(map, 2)).toMatchObject({ bar: 2, beatInBar: 1 });
  });

  it("shows nothing rather than inventing bar 1 before the first beat", () => {
    expect(beatAtTime(buildBeatMap([1, 1.5, 2]), 0.4)).toBeNull();
    expect(beatAtTime([], 4)).toBeNull();
  });
});

describe("estimateDownbeatPhase", () => {
  it("finds the phase the chord changes agree on", () => {
    const beats = steadyBeats(32);
    // Harmony moves every four beats starting at beat index 2, so the bar line
    // is two beats later than the first detected beat.
    const segments = [chord("C", 0, 1), chord("F", 1, 3), chord("G", 3, 5), chord("C", 5, 7)];
    expect(estimateDownbeatPhase(beats, segments, DEFAULT_TIME_SIGNATURE)).toBe(2);
  });

  it("abstains from changes that do not land on a beat", () => {
    const beats = steadyBeats(32);
    const offGrid = [chord("C", 0, 1.23), chord("F", 1.23, 2.71), chord("G", 2.71, 4.19)];
    expect(estimateDownbeatPhase(beats, offGrid, DEFAULT_TIME_SIGNATURE)).toBe(0);
  });

  it("falls back to the old beat-zero assumption when there is no evidence", () => {
    expect(estimateDownbeatPhase(steadyBeats(32), [], DEFAULT_TIME_SIGNATURE)).toBe(0);
    expect(estimateDownbeatPhase([0, 0.5], [chord("C", 0.5, 1)], DEFAULT_TIME_SIGNATURE)).toBe(0);
  });

  it("has nothing to estimate in a one-beat bar", () => {
    expect(estimateDownbeatPhase(steadyBeats(32), [], { beatsPerBar: 1, beatUnit: 4 })).toBe(0);
  });
});

describe("snapSections", () => {
  const downbeats = [0, 2, 4, 6, 8];

  it("moves boundaries onto bar lines and keeps the lane gap-free", () => {
    const snapped = snapSections(
      [
        { label: "A", startSec: 0, endSec: 3.4, confidence: 0.5 },
        { label: "B", startSec: 3.4, endSec: 8, confidence: 0.8 },
      ],
      downbeats,
    );
    expect(snapped.map((section) => [section.startSec, section.endSec])).toEqual([[0, 4], [4, 8]]);
  });

  it("never moves the start of the song", () => {
    const snapped = snapSections([{ label: "A", startSec: 0.3, endSec: 8, confidence: 0.5 }], downbeats);
    expect(snapped[0].startSec).toBe(0.3);
  });

  it("absorbs a section whose boundaries collapse onto one bar line", () => {
    const snapped = snapSections(
      [
        { label: "A", startSec: 0, endSec: 4.1, confidence: 0.5 },
        { label: "B", startSec: 4.1, endSec: 4.2, confidence: 0.6 },
        { label: "C", startSec: 4.2, endSec: 8, confidence: 0.7 },
      ],
      downbeats,
    );
    expect(snapped.map((section) => section.label)).toEqual(["A", "C"]);
    expect(snapped.map((section) => [section.startSec, section.endSec])).toEqual([[0, 4], [4, 8]]);
  });

  it("passes sections through untouched when there is no bar grid", () => {
    const sections = [{ label: "A", startSec: 0, endSec: 3.4, confidence: 0.5 }];
    expect(snapSections(sections, [])).toEqual(sections);
    expect(snapSections([], downbeats)).toEqual([]);
  });

  it("carries extra fields, so a rename survives re-snapping", () => {
    const [snapped] = snapSections(
      [{ label: "Chorus", startSec: 0, endSec: 8, confidence: 0.5, edited: true, detectedKey: "0.000" }],
      downbeats,
    );
    expect(snapped).toMatchObject({ label: "Chorus", edited: true, detectedKey: "0.000" });
  });
});

describe("time signature labels", () => {
  it("round-trips through its label", () => {
    expect(formatTimeSignature({ beatsPerBar: 6, beatUnit: 8 })).toBe("6/8");
    expect(parseTimeSignature("3/4")).toEqual({ beatsPerBar: 3, beatUnit: 4 });
  });

  it("falls back to 4/4 rather than accepting an unknown metre", () => {
    expect(parseTimeSignature("13/16")).toEqual(DEFAULT_TIME_SIGNATURE);
  });

  it("formats a position for the ruler", () => {
    expect(formatBarBeat({ timeSec: 4, bar: 3, beatInBar: 2 })).toBe("3.2");
  });
});

describe("buildClickPoints", () => {
  it("accents the downbeat of the bar, not every fourth detected beat", () => {
    const map = buildBeatMap(steadyBeats(8), DEFAULT_TIME_SIGNATURE, 2);
    const accents = buildClickPoints(map, 1)
      .filter((point) => point.accent)
      .map((point) => point.time);
    expect(accents).toEqual([1, 3]);
  });

  it("accents every third beat in 3/4, which index % 4 could never do", () => {
    const map = buildBeatMap(steadyBeats(9), { beatsPerBar: 3, beatUnit: 4 }, 0);
    const accents = buildClickPoints(map, 1)
      .filter((point) => point.accent)
      .map((point) => point.time);
    expect(accents).toEqual([0, 1.5, 3]);
  });

  it("halves the click count at 0.5x and keeps the accent on the bar", () => {
    const map = buildBeatMap(steadyBeats(8), DEFAULT_TIME_SIGNATURE, 0);
    const points = buildClickPoints(map, 0.5);
    expect(points.map((point) => point.time)).toEqual([0, 1, 2, 3]);
    expect(points.filter((point) => point.accent).map((point) => point.time)).toEqual([0, 2]);
  });

  it("keeps the accent alive at 0.5x when the downbeat lands on an odd beat", () => {
    // Taking the even indices unconditionally would drop every downbeat here
    // and leave the musician a click with no bar in it.
    const map = buildBeatMap(steadyBeats(8), DEFAULT_TIME_SIGNATURE, 1);
    const points = buildClickPoints(map, 0.5);
    expect(points.map((point) => point.time)).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(points.filter((point) => point.accent).map((point) => point.time)).toEqual([0.5, 2.5]);
  });

  it("inserts unaccented offbeats at 2x without adding a trailing one", () => {
    const map = buildBeatMap(steadyBeats(4), DEFAULT_TIME_SIGNATURE, 0);
    const points = buildClickPoints(map, 2);
    expect(points.map((point) => point.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    expect(points.filter((point) => point.accent).map((point) => point.time)).toEqual([0]);
  });

  it("produces no clicks for an unanalysed session", () => {
    expect(buildClickPoints([], 1)).toEqual([]);
  });
});
