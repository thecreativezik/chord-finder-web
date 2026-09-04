import { describe, expect, it } from "vitest";

import { encodeStereoWav } from "../src/audio/wav";

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );
}

describe("encodeStereoWav", () => {
  it("writes a valid stereo PCM16 header and exact data length", () => {
    const left = new Float32Array([0, 0.5, -1, 1]);
    const right = new Float32Array([0, -0.5, 1, -1]);
    const encoded = encodeStereoWav(left, right, 44_100);
    const view = new DataView(encoded);

    expect(encoded.byteLength).toBe(44 + 4 * 4);
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(encoded.byteLength - 8);
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(28, true)).toBe(44_100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(4 * 4);
  });

  it("uses the shorter channel and clamps samples to PCM16 range", () => {
    const encoded = encodeStereoWav(
      new Float32Array([2, -2, 0]),
      new Float32Array([-2, 2]),
      48_000,
    );
    const view = new DataView(encoded);

    expect(encoded.byteLength).toBe(44 + 2 * 4);
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(-32_768);
    expect(view.getInt16(50, true)).toBe(32_767);
  });
});
