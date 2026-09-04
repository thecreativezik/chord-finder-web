import { describe, expect, it } from "vitest";

import { metronomeDelayUntilBeat, metronomeSourceTime } from "../src/components/use-metronome";

describe("metronome SoundTouch alignment", () => {
  it("allows negative scheduler time while the processor fills at song start", () => {
    expect(metronomeSourceTime(0, 0.08)).toBeCloseTo(-0.08);
  });

  it("delays a beat at a seek target until the processed audio reaches it", () => {
    expect(metronomeDelayUntilBeat(42, 42, 0.08, 1)).toBeCloseTo(0.08);
  });

  it("converts source-time latency into wall-clock delay at the active rate", () => {
    expect(metronomeDelayUntilBeat(12, 12, 0.08, 0.5)).toBeCloseTo(0.16);
    expect(metronomeDelayUntilBeat(12, 12, 0.08, 2)).toBeCloseTo(0.04);
  });

  it("has no delay correction on the direct, zero-latency route", () => {
    expect(metronomeSourceTime(15, 0)).toBe(15);
    expect(metronomeDelayUntilBeat(15, 15, 0, 1)).toBe(0);
  });
});
