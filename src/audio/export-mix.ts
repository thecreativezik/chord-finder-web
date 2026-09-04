import { processOffline } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";

import { decodeAudioStereo, SESSION_SAMPLE_RATE } from "./decode-audio";
import {
  cropOfflinePitchChannel,
  planOfflinePitchAlignment,
} from "./offline-pitch-alignment";
import { SerialTaskQueue } from "./serial-task-queue";
import { SOUND_TOUCH_STRETCH_PARAMETERS } from "./soundtouch-config";

export type ExportFormat = "wav" | "mp3";

export interface ExportMixTrack {
  name: string;
  blob: Blob;
  volume: number;
}

export type ExportStage = "decoding" | "mixing" | "transposing" | "encoding";

interface WorkerPcmTrack {
  left: Float32Array;
  right: Float32Array;
  volume: number;
}

interface MixRequest {
  type: "mix";
  requestId: number;
  tracks: WorkerPcmTrack[];
  frameCount: number;
  sampleRate: number;
  format: ExportFormat;
  returnPcm: boolean;
}

interface EncodeRequest {
  type: "encode";
  requestId: number;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  format: ExportFormat;
}

type WorkerRequest = MixRequest | EncodeRequest;

interface MixedResult {
  type: "mixed";
  requestId: number;
  left: Float32Array;
  right: Float32Array;
}

interface EncodeResult {
  type: "result";
  requestId: number;
  bytes: ArrayBuffer;
  mimeType: string;
}

type WorkerResponse =
  | MixedResult
  | EncodeResult
  | { type: "progress"; requestId: number; stage: "mixing" | "encoding"; progress: number }
  | { type: "error"; requestId: number; message: string };

const MAX_ESTIMATED_PCM_BYTES = 900 * 1024 * 1024;

export interface RenderMixOptions {
  tracks: ExportMixTrack[];
  durationSec: number;
  pitchSemitones: number;
  format: ExportFormat;
  sessionName: string;
  onProgress: (stage: ExportStage, progress: number) => void;
  signal?: AbortSignal;
}

// OfflineAudioContext rendering has no cancellation primitive. Keep the actual
// task (not the caller-facing abort race) in this chain so a cancelled render
// retains the slot until its underlying promise settles. Replacement exports
// therefore cannot overlap it and multiply large PCM allocations.
const exportRenderQueue = new SerialTaskQueue();

function safeFileName(value: string): string {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "chord-finder-mix";
}

function abortError(): DOMException {
  return new DOMException("Mix export was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function runWorkerRequest(
  worker: Worker,
  request: WorkerRequest,
  transfer: Transferable[],
  signal: AbortSignal | undefined,
  onProgress: (stage: ExportStage, progress: number) => void,
): Promise<MixedResult | EncodeResult> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : abortError());
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || "The audio export worker stopped unexpectedly."));
    };
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== request.requestId) return;
      if (message.type === "progress") {
        throwIfAborted(signal);
        onProgress(message.stage, message.progress);
        return;
      }
      cleanup();
      if (message.type === "error") reject(new Error(message.message));
      else resolve(message);
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage(request, transfer);
  });
}

function audioBufferFromPcm(
  left: Float32Array,
  right: Float32Array,
  tailPaddingFrames = 0,
): AudioBuffer {
  const frames = Math.min(left.length, right.length);
  const buffer = new AudioBuffer({
    numberOfChannels: 2,
    length: frames + Math.max(0, Math.floor(tailPaddingFrames)),
    sampleRate: SESSION_SAMPLE_RATE,
  });
  buffer.copyToChannel(new Float32Array(left.subarray(0, frames)), 0);
  buffer.copyToChannel(new Float32Array(right.subarray(0, frames)), 1);
  return buffer;
}

async function performMixExport({
  tracks,
  durationSec,
  pitchSemitones,
  format,
  sessionName,
  onProgress,
  signal,
}: RenderMixOptions): Promise<void> {
  throwIfAborted(signal);
  if (tracks.length === 0) throw new Error("Turn on at least one track before exporting.");
  const frames = Math.max(1, Math.ceil(durationSec * SESSION_SAMPLE_RATE));
  const estimatedBytes = frames * 2 * 4 * (2 + tracks.length);
  if (estimatedBytes > MAX_ESTIMATED_PCM_BYTES) {
    throw new Error("This mix is too large to render safely in the browser. Export fewer stems or a shorter source file.");
  }

  const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
  const terminateOnAbort = () => worker.terminate();
  signal?.addEventListener("abort", terminateOnAbort, { once: true });

  try {
    const decodedTracks: WorkerPcmTrack[] = [];
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      throwIfAborted(signal);
      onProgress("decoding", trackIndex / tracks.length);
      const track = tracks[trackIndex];
      // decodeAudioData cannot be cancelled. Await its real settlement so the
      // serialization slot is not released while the decoder still owns PCM.
      const decoded = await decodeAudioStereo(track.blob);
      throwIfAborted(signal);
      decodedTracks.push({
        left: decoded.left,
        right: decoded.right,
        volume: Math.max(0, Math.min(1, track.volume)),
      });
      onProgress("decoding", (trackIndex + 1) / tracks.length);
      // Yield between independently decoded tracks so cancellation and paint run promptly.
      await abortable(new Promise<void>((resolve) => window.setTimeout(resolve, 0)), signal);
    }

    const needsPitchRender = Math.abs(pitchSemitones) >= 0.001;
    onProgress("mixing", 0);
    const mixRequest: MixRequest = {
      type: "mix",
      requestId: 1,
      tracks: decodedTracks,
      frameCount: frames,
      sampleRate: SESSION_SAMPLE_RATE,
      format,
      returnPcm: needsPitchRender,
    };
    const mixTransfer = decodedTracks.flatMap((track) => [track.left.buffer, track.right.buffer]);
    const mixedOrEncoded = await runWorkerRequest(worker, mixRequest, mixTransfer, signal, onProgress);

    let encoded: EncodeResult;
    if (mixedOrEncoded.type === "result") {
      encoded = mixedOrEncoded;
    } else {
      throwIfAborted(signal);
      onProgress("transposing", 0.1);
      // Export runs at 1×. Pad the source timeline by SoundTouch's fixed
      // lookahead so processOffline's fixed output allocation can carry the
      // original tail, then crop the same delay in rendered-output frames.
      const alignment = planOfflinePitchAlignment(
        Math.min(mixedOrEncoded.left.length, mixedOrEncoded.right.length),
        pitchSemitones,
        SESSION_SAMPLE_RATE,
        1,
      );
      const mixedBuffer = audioBufferFromPcm(
        mixedOrEncoded.left,
        mixedOrEncoded.right,
        alignment.sourcePaddingFrames,
      );
      // OfflineAudioContext cannot be stopped once rendering begins. Do not
      // race this internal promise with AbortSignal: the public caller may
      // return early, but the queue must remain occupied until this settles.
      const rendered = await processOffline({
        input: mixedBuffer,
        processorUrl,
        pitchSemitones,
        playbackRate: 1,
        stretchParameters: SOUND_TOUCH_STRETCH_PARAMETERS,
      });
      throwIfAborted(signal);
      onProgress("transposing", 1);

      const left = cropOfflinePitchChannel(rendered.getChannelData(0), alignment);
      const right = cropOfflinePitchChannel(
        rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1)),
        alignment,
      );
      onProgress("encoding", 0);
      const encodeRequest: EncodeRequest = {
        type: "encode",
        requestId: 2,
        left,
        right,
        sampleRate: rendered.sampleRate,
        format,
      };
      const response = await runWorkerRequest(
        worker,
        encodeRequest,
        [left.buffer, right.buffer],
        signal,
        onProgress,
      );
      if (response.type !== "result") throw new Error("The export worker returned incomplete audio.");
      encoded = response;
    }

    throwIfAborted(signal);
    const blob = new Blob([encoded.bytes], { type: encoded.mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(sessionName)}-mix.${format}`;
      anchor.hidden = true;
      document.body.append(anchor);
      throwIfAborted(signal);
      anchor.click();
      anchor.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }
  } finally {
    signal?.removeEventListener("abort", terminateOnAbort);
    worker.terminate();
  }
}

/**
 * Render the currently audible track set and start a local file download.
 * Calls are serialized to bound peak memory. Cancellation rejects the caller
 * promptly, while an uncancellable in-flight browser render drains privately;
 * every post-render side effect is still guarded by the same signal.
 */
export function renderAndDownloadMix(options: RenderMixOptions): Promise<void> {
  throwIfAborted(options.signal);
  return exportRenderQueue.run(() => performMixExport(options), options.signal);
}
