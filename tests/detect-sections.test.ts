import { describe, expect, it } from "vitest";

import { buildBeatMap, downbeatTimes } from "../src/analysis/beat-map";
import { detectSections } from "../src/analysis/detect-sections";
import type { SectionSegment } from "../src/types";

// ── Synthetic fixtures ────────────────────────────────────────────────────
// Real audio would make these tests slow, non-deterministic and dependent on
// the essentia WASM build. The detector only ever sees chroma frames, so we
// hand it chroma directly: one triad per bar, plus a seeded jitter so the
// matrix is not implausibly clean.

const PITCH_CLASSES: Record<string, number[]> = {
  C: [0, 4, 7],
  F: [5, 9, 0],
  G: [7, 11, 2],
  Am: [9, 0, 4],
  Dm: [2, 5, 9],
  E: [4, 8, 11],
  Eb: [3, 7, 10],
  Ab: [8, 0, 3],
  Bb: [10, 2, 5],
};

const BEAT_SEC = 0.5; // 120 BPM
const BEATS_PER_BAR = 4;
const FRAME_SEC = 0.1;
const JITTER = 0.2;

interface Part {
  chords: string[];
  bars: number;
  /** Section loudness, which is what separates a quiet verse from a loud chorus. */
  gain: number;
}

interface Fixture {
  frames: Float32Array[];
  frameTimes: number[];
  beats: number[];
  durationSec: number;
}

function buildFixture(parts: Part[], seed = 12_345): Fixture {
  let state = seed;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };

  const barSec = BEAT_SEC * BEATS_PER_BAR;
  const plan: { chord: string; gain: number; start: number; end: number }[] = [];
  let cursor = 0;
  for (const part of parts) {
    for (let bar = 0; bar < part.bars; bar++) {
      const chord = part.chords[bar % part.chords.length];
      plan.push({ chord, gain: part.gain, start: cursor, end: cursor + barSec });
      cursor += barSec;
    }
  }

  const durationSec = cursor;
  const frames: Float32Array[] = [];
  const frameTimes: number[] = [];
  let planIndex = 0;
  for (let time = 0; time < durationSec - 1e-9; time += FRAME_SEC) {
    while (planIndex < plan.length - 1 && time >= plan[planIndex].end) planIndex += 1;
    const active = plan[planIndex];
    const chroma = new Float32Array(12);
    // A quiet noise floor in every bin, so no bin is ever exactly zero.
    for (let bin = 0; bin < 12; bin++) {
      chroma[bin] = active.gain * 0.04 * (1 + JITTER * (random() - 0.5));
    }
    for (const pitchClass of PITCH_CLASSES[active.chord]) {
      chroma[pitchClass] = active.gain * (1 + JITTER * (random() - 0.5));
    }
    frames.push(chroma);
    frameTimes.push(Number(time.toFixed(4)));
  }

  const beats = Array.from(
    { length: Math.floor(durationSec / BEAT_SEC) },
    (_, index) => index * BEAT_SEC,
  );
  return { frames, frameTimes, beats, durationSec };
}

function detect(fixture: Fixture, quantise = true): SectionSegment[] {
  return detectSections({
    ...fixture,
    downbeats: quantise ? downbeatTimes(buildBeatMap(fixture.beats)) : undefined,
  });
}

const VERSE: Part = { chords: ["C", "F", "G", "C"], bars: 16, gain: 1 };
const CHORUS: Part = { chords: ["Am", "Dm", "E", "Am"], bars: 16, gain: 1.6 };
const BRIDGE: Part = { chords: ["Eb", "Ab", "Bb", "Eb"], bars: 16, gain: 1.3 };

/** Invariants every caller of the lane is entitled to assume. */
function expectWellFormed(sections: SectionSegment[], durationSec: number) {
  for (const [index, section] of sections.entries()) {
    expect(section.endSec).toBeGreaterThan(section.startSec);
    expect(section.startSec).toBeGreaterThanOrEqual(0);
    expect(section.endSec).toBeLessThanOrEqual(durationSec);
    expect(section.confidence).toBeGreaterThanOrEqual(0);
    expect(section.confidence).toBeLessThanOrEqual(1);
    expect(section.label.length).toBeGreaterThan(0);
    if (index > 0) expect(section.startSec).toBe(sections[index - 1].endSec);
  }
  if (sections.length > 0) {
    expect(sections[0].startSec).toBe(0);
    expect(sections[sections.length - 1].endSec).toBe(durationSec);
  }
}

describe("detectSections", () => {
  it("finds an A-B-A arrangement on its bar lines and recognises the repeat", () => {
    const fixture = buildFixture([VERSE, CHORUS, VERSE]);
    const sections = detect(fixture);

    expect(sections.map((section) => section.label)).toEqual(["A", "B", "A2"]);
    expect(sections.map((section) => section.startSec)).toEqual([0, 32, 64]);
    expect(sections[2].endSec).toBe(96);
    expectWellFormed(sections, fixture.durationSec);
  });

  it("recognises the repeat across a key change too", () => {
    const fixture = buildFixture([VERSE, BRIDGE, VERSE]);
    expect(detect(fixture).map((section) => section.label)).toEqual(["A", "B", "A2"]);
  });

  it("labels a third, unrelated part with a third letter", () => {
    const fixture = buildFixture([VERSE, CHORUS, BRIDGE]);
    expect(detect(fixture).map((section) => section.label)).toEqual(["A", "B", "C"]);
  });

  it("reads a two-part song", () => {
    const fixture = buildFixture([VERSE, CHORUS]);
    const sections = detect(fixture);
    expect(sections).toHaveLength(2);
    expect(sections[1].startSec).toBe(32);
    expectWellFormed(sections, fixture.durationSec);
  });

  it("reports nothing for a song that loops one progression start to finish", () => {
    // The false-positive case that matters. Chord changes every bar produce a
    // novelty ripple; none of it is structure, and claiming four sections here
    // would be worse than claiming none.
    const fixture = buildFixture([{ chords: ["C", "F", "G", "C"], bars: 48, gain: 1 }]);
    expect(detect(fixture)).toEqual([]);
  });

  it("reports nothing rather than throwing on input too short to read", () => {
    expect(detect(buildFixture([{ chords: ["C", "F"], bars: 4, gain: 1 }]))).toEqual([]);
    expect(
      detectSections({ frames: [], frameTimes: [], beats: [], durationSec: 0 }),
    ).toEqual([]);
    expect(
      detectSections({ frames: [], frameTimes: [], beats: [], durationSec: Number.NaN }),
    ).toEqual([]);
  });

  it("still reads structure when beat tracking produced nothing", () => {
    // buildAnalysisWindows falls back to fixed slices, so the lane degrades to
    // unquantised boundaries instead of disappearing.
    const fixture = buildFixture([VERSE, CHORUS, VERSE]);
    const sections = detectSections({ ...fixture, beats: [], durationSec: fixture.durationSec });
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expectWellFormed(sections, fixture.durationSec);
  });

  it("leaves boundaries unquantised when no bar grid is supplied", () => {
    const fixture = buildFixture([VERSE, CHORUS, VERSE]);
    const sections = detect(fixture, false);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    expectWellFormed(sections, fixture.durationSec);
  });

  it("is deterministic", () => {
    const first = detect(buildFixture([VERSE, CHORUS, VERSE]));
    const second = detect(buildFixture([VERSE, CHORUS, VERSE]));
    expect(second).toEqual(first);
  });

  it("emits no section shorter than four bars", () => {
    const fixture = buildFixture([
      VERSE,
      { chords: ["Am"], bars: 2, gain: 1.6 }, // a two-bar stab, below the floor
      CHORUS,
      VERSE,
    ]);
    const sections = detect(fixture);
    const barSec = BEAT_SEC * BEATS_PER_BAR;
    for (const section of sections) {
      expect(section.endSec - section.startSec).toBeGreaterThanOrEqual(4 * barSec);
    }
    expectWellFormed(sections, fixture.durationSec);
  });

  it("stays inside its stated time budget on a five-minute song", () => {
    // Budget from the design note: under 250 ms in the worker, against a chord
    // decode already measured in seconds. Wide margin, so this is a regression
    // guard against an accidentally quadratic change, not a benchmark.
    const fixture = buildFixture([VERSE, CHORUS, VERSE, CHORUS, BRIDGE, VERSE, CHORUS]);
    expect(fixture.durationSec).toBeGreaterThan(200);
    const started = performance.now();
    detect(fixture);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("caps the similarity matrix instead of going quadratic on a long mix", () => {
    // 30 minutes. Without the stride cap this would be a 3,600-square matrix.
    const fixture = buildFixture([
      { chords: ["C", "F", "G", "C"], bars: 150, gain: 1 },
      { chords: ["Am", "Dm", "E", "Am"], bars: 150, gain: 1.5 },
      { chords: ["Eb", "Ab", "Bb", "Eb"], bars: 150, gain: 1.2 },
    ]);
    const started = performance.now();
    const sections = detect(fixture);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(sections.map((section) => section.label)).toEqual(["A", "B", "C"]);
    expectWellFormed(sections, fixture.durationSec);
  });
});
