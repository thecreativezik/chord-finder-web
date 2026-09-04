import { SESSION_SAMPLE_RATE } from "./decode-audio";

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function floatToPcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/** Encode aligned stereo PCM to a broadly supported 16-bit WAV file. */
export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const frames = Math.min(left.length, right.length);
  const bytesPerFrame = 4;
  const buffer = new ArrayBuffer(44 + frames * bytesPerFrame);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + frames * bytesPerFrame, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frames * bytesPerFrame, true);

  let offset = 44;
  for (let index = 0; index < frames; index += 1) {
    view.setInt16(offset, floatToPcm16(left[index]), true);
    view.setInt16(offset + 2, floatToPcm16(right[index]), true);
    offset += bytesPerFrame;
  }
  return buffer;
}

/** Encode one separated stereo stem to WAV without an AudioBuffer copy. */
export function stereoPcmToWavBlob(left: Float32Array, right: Float32Array): Blob {
  return new Blob([encodeStereoWav(left, right, SESSION_SAMPLE_RATE)], { type: "audio/wav" });
}
