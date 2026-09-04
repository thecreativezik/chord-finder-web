/// <reference lib="webworker" />

import { Mp3Encoder } from "@breezystack/lamejs";

import { encodeStereoWav } from "./wav";

interface PcmTrack {
  left: Float32Array;
  right: Float32Array;
  volume: number;
}

interface MixRequest {
  type: "mix";
  requestId: number;
  tracks: PcmTrack[];
  frameCount: number;
  sampleRate: number;
  format: "wav" | "mp3";
  returnPcm: boolean;
}

interface EncodeRequest {
  type: "encode";
  requestId: number;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  format: "wav" | "mp3";
}

type EncodeResponse =
  | { type: "progress"; requestId: number; stage: "mixing" | "encoding"; progress: number }
  | { type: "mixed"; requestId: number; left: Float32Array; right: Float32Array }
  | { type: "result"; requestId: number; bytes: ArrayBuffer; mimeType: string }
  | { type: "error"; requestId: number; message: string };

function post(message: EncodeResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function floatToInt16(input: Float32Array, start: number, end: number): Int16Array {
  const result = new Int16Array(end - start);
  for (let index = start; index < end; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    result[index - start] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return result;
}

function encodeMp3(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  requestId: number,
): ArrayBuffer {
  const encoder = new Mp3Encoder(2, sampleRate, 256);
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;
  const frames = Math.min(left.length, right.length);
  let byteLength = 0;

  for (let start = 0; start < frames; start += blockSize) {
    const end = Math.min(frames, start + blockSize);
    const encoded = encoder.encodeBuffer(
      floatToInt16(left, start, end),
      floatToInt16(right, start, end),
    );
    if (encoded.length) {
      chunks.push(encoded);
      byteLength += encoded.length;
    }
    if (start % (blockSize * 160) === 0) {
      post({ type: "progress", requestId, stage: "encoding", progress: frames ? start / frames : 1 });
    }
  }

  const tail = encoder.flush();
  if (tail.length) {
    chunks.push(tail);
    byteLength += tail.length;
  }

  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined.buffer;
}

function normalizeIfClipping(left: Float32Array, right: Float32Array): void {
  let peak = 0;
  const frames = Math.min(left.length, right.length);
  for (let index = 0; index < frames; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  if (peak <= 0.999) return;
  const gain = 0.891 / peak;
  for (let index = 0; index < frames; index += 1) {
    left[index] *= gain;
    right[index] *= gain;
  }
}

function mixTracks(request: MixRequest): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(request.frameCount);
  const right = new Float32Array(request.frameCount);
  const totalFrames = request.tracks.reduce(
    (sum, track) => sum + Math.min(request.frameCount, track.left.length, track.right.length),
    0,
  );
  let mixedFrames = 0;
  const progressStride = 65_536;

  for (const track of request.tracks) {
    const frames = Math.min(request.frameCount, track.left.length, track.right.length);
    const volume = Math.max(0, Math.min(1, track.volume));
    for (let index = 0; index < frames; index += 1) {
      left[index] += track.left[index] * volume;
      right[index] += track.right[index] * volume;
      if (index > 0 && index % progressStride === 0) {
        post({
          type: "progress",
          requestId: request.requestId,
          stage: "mixing",
          progress: totalFrames ? (mixedFrames + index) / totalFrames : 1,
        });
      }
    }
    mixedFrames += frames;
  }
  normalizeIfClipping(left, right);
  post({ type: "progress", requestId: request.requestId, stage: "mixing", progress: 1 });
  return { left, right };
}

function encodeAndPost(request: EncodeRequest): void {
  // Pitch processing can add peaks even when the pre-transpose mix was safe.
  normalizeIfClipping(request.left, request.right);
  const bytes = request.format === "wav"
    ? encodeStereoWav(request.left, request.right, request.sampleRate)
    : encodeMp3(request.left, request.right, request.sampleRate, request.requestId);
  post(
    {
      type: "result",
      requestId: request.requestId,
      bytes,
      mimeType: request.format === "wav" ? "audio/wav" : "audio/mpeg",
    },
    [bytes],
  );
}

self.onmessage = (event: MessageEvent<MixRequest | EncodeRequest>) => {
  const request = event.data;
  try {
    if (request.type === "encode") {
      encodeAndPost(request);
      return;
    }

    const mixed = mixTracks(request);
    if (request.returnPcm) {
      post(
        { type: "mixed", requestId: request.requestId, left: mixed.left, right: mixed.right },
        [mixed.left.buffer, mixed.right.buffer],
      );
      return;
    }
    encodeAndPost({
      type: "encode",
      requestId: request.requestId,
      left: mixed.left,
      right: mixed.right,
      sampleRate: request.sampleRate,
      format: request.format,
    });
  } catch (error) {
    post({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
