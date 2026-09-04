import { describe, expect, it } from "vitest";

import {
  cropOfflinePitchChannel,
  planOfflinePitchAlignment,
} from "../src/audio/offline-pitch-alignment";

describe("offline pitch-render alignment", () => {
  it("pads and crops equal frame counts for the 1x export path", () => {
    const sourceFrames = 441_000;
    const plan = planOfflinePitchAlignment(sourceFrames, 3, 44_100, 1);

    expect(plan.sourceLatencySec).toBeGreaterThan(0);
    expect(plan.outputLatencySec).toBe(plan.sourceLatencySec);
    expect(plan.sourcePaddingFrames).toBe(plan.outputCropStartFrame);
    expect(plan.paddedInputFrameCount - plan.outputCropStartFrame).toBe(sourceFrames);
    expect(plan.outputFrameCount).toBe(sourceFrames);
  });

  it("keeps source and rendered time units distinct away from 1x", () => {
    const plan = planOfflinePitchAlignment(44_100, -2, 44_100, 0.5);

    expect(plan.outputLatencySec).toBeCloseTo(plan.sourceLatencySec / 0.5, 10);
    expect(plan.outputCropStartFrame).toBeGreaterThan(plan.sourcePaddingFrames);
    expect(plan.outputFrameCount).toBe(88_200);
    expect(Math.ceil(plan.paddedInputFrameCount / 0.5) - plan.outputCropStartFrame)
      .toBeGreaterThanOrEqual(plan.outputFrameCount);
  });

  it("removes the delayed prefix and preserves the requested final length", () => {
    const rendered = new Float32Array([0, 0, 0, 1, 2, 3, 4, 9, 9]);
    const cropped = cropOfflinePitchChannel(rendered, {
      outputCropStartFrame: 3,
      outputFrameCount: 4,
    });

    expect(Array.from(cropped)).toEqual([1, 2, 3, 4]);
  });

  it("zero-pads a short browser render rather than changing file duration", () => {
    const cropped = cropOfflinePitchChannel(new Float32Array([0, 5, 6]), {
      outputCropStartFrame: 1,
      outputFrameCount: 4,
    });

    expect(Array.from(cropped)).toEqual([5, 6, 0, 0]);
  });
});
