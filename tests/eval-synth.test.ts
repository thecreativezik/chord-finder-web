import { describe, expect, it } from "vitest";

import { createRng, PROGRESSION, SAMPLE_RATE, synthesize } from "../scripts/eval-synth";

/**
 * Cheap order-sensitive digest of the rendered audio. Comparing 660k floats
 * element-wise per assertion is slow and the failure message is unreadable;
 * this collapses a render to one number that changes if any sample changes.
 */
function digest(audio: Float32Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < audio.length; i++) {
    // Quantize to 24-bit so the digest is not sensitive to float noise that
    // the pipeline itself could not hear, but is sensitive to real changes.
    const q = Math.round(audio[i] * 0x7fffff);
    h = Math.imul(h ^ (q & 0xff), 0x01000193);
    h = Math.imul(h ^ ((q >> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((q >> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ (i & 0xff), 0x01000193);
  }
  return (h >>> 0).toString(16);
}

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    const first = Array.from({ length: 32 }, () => a());
    const second = Array.from({ length: 32 }, () => b());
    expect(second).toEqual(first);
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng(7);
    const b = createRng(8);
    const first = Array.from({ length: 32 }, () => a());
    const second = Array.from({ length: 32 }, () => b());
    expect(second).not.toEqual(first);
  });

  it("stays within [0, 1)", () => {
    const rng = createRng(0);
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("synthesize", () => {
  // The whole point of the harness: two runs of the same commit must score the
  // same audio, or an accuracy delta cannot be attributed to a code change.
  it("renders identical clean-mode audio for the same seed", () => {
    const first = synthesize({ loops: 1, hard: false, seed: 1 });
    const second = synthesize({ loops: 1, hard: false, seed: 1 });
    expect(first.audio.length).toBe(second.audio.length);
    expect(digest(second.audio)).toBe(digest(first.audio));
  });

  it("renders identical hard-mode audio for the same seed", () => {
    const first = synthesize({ loops: 1, hard: true, seed: 1 });
    const second = synthesize({ loops: 1, hard: true, seed: 1 });
    expect(digest(second.audio)).toBe(digest(first.audio));
  });

  // Guards the other half: if the seed were ignored, every seed would render
  // the same audio and the harness would only ever evaluate one song.
  it("renders different audio for a different seed", () => {
    const first = synthesize({ loops: 1, hard: false, seed: 1 });
    const second = synthesize({ loops: 1, hard: false, seed: 2 });
    expect(digest(second.audio)).not.toBe(digest(first.audio));
  });

  it("renders different hard-mode audio for a different seed", () => {
    const first = synthesize({ loops: 1, hard: true, seed: 1 });
    const second = synthesize({ loops: 1, hard: true, seed: 2 });
    expect(digest(second.audio)).not.toBe(digest(first.audio));
  });

  it("returns a contiguous truth timeline covering the rendered audio", () => {
    const loops = 2;
    const { audio, truth } = synthesize({ loops, hard: false, seed: 1 });
    expect(truth).toHaveLength(PROGRESSION.length * loops);
    expect(truth[0].startSec).toBe(0);
    for (let i = 1; i < truth.length; i++) {
      expect(truth[i].startSec).toBeCloseTo(truth[i - 1].endSec, 9);
    }
    const lastEnd = truth[truth.length - 1].endSec;
    expect(audio.length / SAMPLE_RATE).toBeCloseTo(lastEnd, 3);
  });

  it("rejects a non-integer seed rather than silently seeding zero", () => {
    expect(() => synthesize({ loops: 1, hard: false, seed: Number.NaN })).toThrow(/seed/);
    expect(() => synthesize({ loops: 1, hard: false, seed: 1.5 })).toThrow(/seed/);
  });

  it("rejects a loop count that would render no audio", () => {
    expect(() => synthesize({ loops: 0, hard: false, seed: 1 })).toThrow(/loops/);
    expect(() => synthesize({ loops: -1, hard: false, seed: 1 })).toThrow(/loops/);
  });
});
