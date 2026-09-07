import { useCallback, useEffect, useRef, useState } from "react";

import {
  createProvenance,
  ORIGINAL_MIX_SOURCE,
  stemSeparationEngine,
} from "../analysis/provenance";
import { decodeAudioStereo } from "../audio/decode-audio";
import type { StemAssetInput, StemKind } from "../components/use-stem-mixer";
import { DemucsWorkerClient } from "./demucs-worker-client";
import { deleteCachedModel, readCachedModel, writeCachedModel } from "./model-cache";
import { StemEncoderClient } from "./stem-encoder-client";

const MODEL_REVISION = "939723568b2dca203e61cc7294317ba38549964f";
const MODEL_SHA256 = "f56fe666f0bbf3a645764856ed90f8c5dd8cf4430b1d9649b94e29ec45aa9057";
const MODEL_BYTE_LENGTH = 54_890_960;
const MODEL_KEY = `htdemucs_6s@${MODEL_REVISION}:${MODEL_SHA256}`;
const MODEL_URL = `https://huggingface.co/set-soft/audio_separation/resolve/${MODEL_REVISION}/Demucs/htdemucs_6s.safetensors`;
const STEMS = ["drums", "bass", "other", "vocals", "guitar", "piano"];
const WASM_BYTE_LENGTH = 12_319_325;
const MEBIBYTE = 1024 * 1024;
const SAFE_MEMORY_BUDGET_BYTES = 1_200 * MEBIBYTE;
const RUNTIME_HEADROOM_BYTES = 192 * MEBIBYTE;

export type SeparationPhase = "download" | "decode" | "separate" | "encode";

export type SeparationStatus =
  | { state: "idle" }
  | { state: "unsupported"; message: string }
  | { state: "working"; phase: SeparationPhase; progress: number; detail: string }
  | { state: "ready"; stemCount: number }
  | { state: "cancelled" }
  | { state: "error"; message: string };

function supportsSeparation(): boolean {
  return isSecureContext && "gpu" in navigator && typeof Worker !== "undefined";
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Separation cancelled", "AbortError");
}

async function hasExpectedModelIntegrity(bytes: ArrayBuffer, signal: AbortSignal): Promise<boolean> {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== MODEL_BYTE_LENGTH) return false;
  const actualSha256 = await sha256(bytes);
  throwIfAborted(signal);
  return actualSha256 === MODEL_SHA256;
}

export interface SeparationMemoryEstimate {
  requiredBytes: number;
  budgetBytes: number;
  maxDurationSec: number;
}

/**
 * Conservative peak budget for all predictable browser-owned data in the job.
 * This deliberately counts the encoded input, decoded stereo PCM, model/WASM,
 * six PCM16 WAVs, and runtime/GPU bookkeeping headroom. The six-stem Float32
 * result is counted twice: demucs-rs `take_audio()` copies it out of WASM, while
 * the original allocation keeps occupying non-shrinkable WASM linear memory
 * until the inference worker is terminated.
 */
export function estimateSeparationMemory(blobBytes: number, durationSec: number): SeparationMemoryEstimate {
  const frames = Math.max(1, Math.ceil(Math.max(0, durationSec) * 44_100));
  const decodedInputBytes = frames * 2 * Float32Array.BYTES_PER_ELEMENT;
  const separatedFloatBytes = frames * STEMS.length * 2 * Float32Array.BYTES_PER_ELEMENT;
  const encodedStemBytes = frames * STEMS.length * 2 * Int16Array.BYTES_PER_ELEMENT + STEMS.length * 44;
  const fixedBytes = MODEL_BYTE_LENGTH + WASM_BYTE_LENGTH + Math.max(0, blobBytes) + RUNTIME_HEADROOM_BYTES;
  const requiredBytes = fixedBytes + decodedInputBytes + separatedFloatBytes * 2 + encodedStemBytes;
  const bytesPerSecond = 44_100 * 2 * (
    Float32Array.BYTES_PER_ELEMENT +
    STEMS.length * Float32Array.BYTES_PER_ELEMENT * 2 +
    STEMS.length * Int16Array.BYTES_PER_ELEMENT
  );
  const maxDurationSec = Math.max(0, Math.floor((SAFE_MEMORY_BUDGET_BYTES - fixedBytes) / bytesPerSecond));
  return { requiredBytes, budgetBytes: SAFE_MEMORY_BUDGET_BYTES, maxDurationSec };
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds / 15) * 15);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

async function downloadModel(
  signal: AbortSignal,
  onProgress: (progress: number, detail: string) => void,
): Promise<ArrayBuffer> {
  let cached: Awaited<ReturnType<typeof readCachedModel>> = null;
  try {
    cached = await readCachedModel(MODEL_KEY);
  } catch (error) {
    console.warn("[chord-finder] Model cache unavailable; downloading without cache.", error);
  }

  if (cached) {
    let cacheIsValid = false;
    try {
      onProgress(0.2, "Verifying the cached AI model");
      cacheIsValid = await hasExpectedModelIntegrity(cached.bytes, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      console.warn("[chord-finder] Could not verify the cached separation model.", error);
    }
    if (cacheIsValid) {
      onProgress(1, "AI model verified and loaded from this browser");
      return cached.bytes;
    }
    try {
      await deleteCachedModel(MODEL_KEY);
      console.warn("[chord-finder] Removed a corrupt cached separation model.");
    } catch (error) {
      console.warn("[chord-finder] Could not remove the corrupt cached separation model; ignoring it.", error);
    }
  }

  throwIfAborted(signal);
  const response = await fetch(MODEL_URL, { signal });
  if (!response.ok) throw new Error(`Could not download the separation model (${response.status}).`);
  let modelBuffer: ArrayBuffer;
  if (!response.body) {
    modelBuffer = await response.arrayBuffer();
    onProgress(0.9, "Verifying downloaded AI model");
  } else {
    const bytes = new Uint8Array(MODEL_BYTE_LENGTH);
    const reader = response.body.getReader();
    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length) throw new Error("The model download was larger than expected.");
      bytes.set(value, offset);
      offset += value.length;
      onProgress(offset / MODEL_BYTE_LENGTH, `Downloading local AI model · ${Math.round(offset / MEBIBYTE)} of 52 MB`);
    }
    if (offset !== MODEL_BYTE_LENGTH) throw new Error("The separation model download was incomplete.");
    modelBuffer = bytes.buffer;
  }

  if (!(await hasExpectedModelIntegrity(modelBuffer, signal))) {
    throw new Error("The separation model failed its integrity check. Reload and try again on a stable connection.");
  }
  throwIfAborted(signal);
  try {
    await writeCachedModel({
      key: MODEL_KEY,
      bytes: modelBuffer,
      byteLength: MODEL_BYTE_LENGTH,
      sha256: MODEL_SHA256,
    });
  } catch (error) {
    console.warn("[chord-finder] Model could not be cached; this session can still continue.", error);
  }
  onProgress(1, "AI model downloaded and verified");
  return modelBuffer;
}

function stemKind(name: string): Exclude<StemKind, "original"> {
  if (name === "piano") return "keys";
  if (name === "drums" || name === "bass" || name === "vocals" || name === "guitar") return name;
  return "other";
}

function displayName(name: string): string {
  if (name === "piano") return "Piano / keys";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function useSeparation(onComplete: (assets: StemAssetInput[]) => void): {
  status: SeparationStatus;
  separate: (blob: Blob, durationSec: number) => Promise<void>;
  cancel: () => void;
  reset: () => void;
} {
  const [status, setStatus] = useState<SeparationStatus>(() => supportsSeparation()
    ? { state: "idle" }
    : { state: "unsupported", message: "Automatic separation needs WebGPU in a current desktop Chrome or Edge browser." });
  const callbackRef = useRef(onComplete);
  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<DemucsWorkerClient | null>(null);
  const encoderRef = useRef<StemEncoderClient | null>(null);
  const jobRef = useRef(0);
  callbackRef.current = onComplete;

  const stopActiveJob = useCallback(() => {
    jobRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    encoderRef.current?.terminate();
    encoderRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    stopActiveJob();
    setStatus({ state: "cancelled" });
  }, [stopActiveJob]);

  const reset = useCallback(() => {
    stopActiveJob();
    setStatus(supportsSeparation()
      ? { state: "idle" }
      : { state: "unsupported", message: "Automatic separation needs WebGPU in a current desktop Chrome or Edge browser." });
  }, [stopActiveJob]);

  useEffect(() => () => {
    abortRef.current?.abort();
    workerRef.current?.terminate();
    encoderRef.current?.terminate();
  }, []);

  const separate = useCallback(async (blob: Blob, durationSec: number) => {
    if (!supportsSeparation()) {
      setStatus({ state: "unsupported", message: "Automatic separation needs WebGPU in a current desktop Chrome or Edge browser." });
      return;
    }
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      setStatus({ state: "error", message: "Could not determine this song's duration. Re-open the audio file and try again." });
      return;
    }
    const memory = estimateSeparationMemory(blob.size, durationSec);
    if (memory.requiredBytes > memory.budgetBytes) {
      const safeDuration = formatDuration(memory.maxDurationSec);
      const estimatedMb = Math.ceil(memory.requiredBytes / MEBIBYTE);
      setStatus({
        state: "error",
        message: `This six-stem job would need about ${estimatedMb.toLocaleString()} MB of browser memory. Trim or split the song to about ${safeDuration} per section, or import pre-separated stems.`,
      });
      return;
    }

    stopActiveJob();
    const startedAt = Date.now();
    const job = jobRef.current;
    const abort = new AbortController();
    abortRef.current = abort;
    let client: DemucsWorkerClient | null = null;
    let encoder: StemEncoderClient | null = null;
    try {
      setStatus({ state: "working", phase: "download", progress: 0, detail: "Checking the local model cache" });
      const modelBuffer = await downloadModel(abort.signal, (progress, detail) => {
        if (job === jobRef.current) setStatus({ state: "working", phase: "download", progress, detail });
      });
      if (job !== jobRef.current) return;
      setStatus({ state: "working", phase: "decode", progress: 0.15, detail: "Preparing stereo audio at 44.1 kHz" });
      const decoded = await decodeAudioStereo(blob);
      if (job !== jobRef.current) return;

      client = new DemucsWorkerClient();
      workerRef.current = client;
      await client.initialize();
      setStatus({ state: "working", phase: "separate", progress: 0, detail: "Starting six-stem WebGPU separation" });
      const result = await client.separate({
        modelBytes: new Uint8Array(modelBuffer),
        left: decoded.left,
        right: decoded.right,
        sampleRate: decoded.sampleRate,
        stems: [...STEMS],
        onProgress: (event) => {
          if (job !== jobRef.current) return;
          const completed = event.type === "chunk_done" ? event.index + 1 : event.index;
          const progress = event.total > 0 ? Math.min(0.99, completed / event.total) : 0;
          setStatus({
            state: "working",
            phase: "separate",
            progress,
            detail: `Separating chunk ${Math.min(completed + 1, event.total)} of ${event.total}`,
          });
        },
      });
      client.terminate("Inference complete");
      if (workerRef.current === client) workerRef.current = null;
      client = null;
      if (job !== jobRef.current) return;
      if (
        result.numStems !== STEMS.length ||
        result.stemNames.length !== STEMS.length ||
        result.audio.length !== result.nSamples * result.numStems * 2
      ) {
        throw new Error("The separator did not return the expected six aligned stems.");
      }
      setStatus({ state: "working", phase: "encode", progress: 0, detail: "Building aligned stem files" });

      encoder = new StemEncoderClient();
      encoderRef.current = encoder;
      const encoded = await encoder.encode({
        audio: result.audio,
        stemNames: result.stemNames,
        nSamples: result.nSamples,
        numStems: result.numStems,
        sampleRate: 44_100,
        onProgress: (complete, total) => {
          if (job !== jobRef.current) return;
          setStatus({
            state: "working",
            phase: "encode",
            progress: complete / total,
            detail: `Built ${complete} of ${total} stems`,
          });
        },
      });
      encoder.terminate("Encoding complete");
      if (encoderRef.current === encoder) encoderRef.current = null;
      encoder = null;
      if (job !== jobRef.current) return;

      // Each stem records the model that produced it. The revision and SHA-256
      // are pinned in this module, so without this the audio leaves the job
      // with no way to say what made it.
      const assets: StemAssetInput[] = encoded.map(({ name, blob: stemBlob }) => ({
        name: displayName(name),
        kind: stemKind(name),
        blob: stemBlob,
        origin: "separated",
        provenance: createProvenance({
          module: "stem-separation",
          source: ORIGINAL_MIX_SOURCE,
          engine: stemSeparationEngine(MODEL_REVISION),
          params: { output: name, stems: STEMS.length },
          startedAt,
        }),
      }));
      callbackRef.current(assets);
      setStatus({ state: "ready", stemCount: assets.length });
    } catch (error) {
      if (job !== jobRef.current || (error instanceof DOMException && error.name === "AbortError")) return;
      console.error("[chord-finder] Separation failed:", error);
      setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (client) client.terminate("Separation complete");
      if (workerRef.current === client) workerRef.current = null;
      if (encoder) encoder.terminate("Encoding complete");
      if (encoderRef.current === encoder) encoderRef.current = null;
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [stopActiveJob]);

  return { status, separate, cancel, reset };
}
