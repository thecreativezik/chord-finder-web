import { describe, expect, it } from "vitest";

import { estimateSeparationMemory } from "../src/separation/use-separation";

describe("six-stem separation memory budget", () => {
  it("allows a two-and-a-half-minute section within the conservative budget", () => {
    const estimate = estimateSeparationMemory(20 * 1024 * 1024, 2.5 * 60);

    expect(estimate.requiredBytes).toBeLessThan(estimate.budgetBytes);
    expect(estimate.maxDurationSec).toBeGreaterThanOrEqual(2.5 * 60);
  });

  it("rejects a four-minute job before allocating oversized buffers", () => {
    const estimate = estimateSeparationMemory(30 * 1024 * 1024, 4 * 60);

    expect(estimate.requiredBytes).toBeGreaterThan(estimate.budgetBytes);
    expect(estimate.maxDurationSec).toBeLessThan(4 * 60);
  });

  it("counts both the WASM-resident and copied six-stem Float32 output", () => {
    const oneMinute = estimateSeparationMemory(10 * 1024 * 1024, 60);
    const oneMinuteAndOneSecond = estimateSeparationMemory(10 * 1024 * 1024, 61);

    // Per frame: decoded stereo Float32 (8 bytes), two six-stem stereo
    // Float32 outputs (96 bytes), and six stereo PCM16 WAVs (24 bytes).
    expect(oneMinuteAndOneSecond.requiredBytes - oneMinute.requiredBytes).toBe(44_100 * 128);
  });

  it("includes the uploaded file size in the maximum safe duration", () => {
    const compactInput = estimateSeparationMemory(5 * 1024 * 1024, 60);
    const largeInput = estimateSeparationMemory(100 * 1024 * 1024, 60);

    expect(largeInput.requiredBytes - compactInput.requiredBytes).toBe(95 * 1024 * 1024);
    expect(largeInput.maxDurationSec).toBeLessThan(compactInput.maxDurationSec);
  });
});
