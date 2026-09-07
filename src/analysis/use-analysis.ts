// Hook that decodes an audio file, runs analysis in a Web Worker, and exposes
// progress + results. A fresh worker is created per file and terminated when
// done, which frees the essentia WASM heap without manual vector bookkeeping.
//
// Web version: files come exclusively from the browser (picker or drag-drop)
// as File objects — no native picker / custom protocol like the macOS app.

import { useCallback, useEffect, useRef, useState } from "react";

import { decodeAudioMono, SESSION_SAMPLE_RATE } from "../audio/decode-audio";
import type {
  AnalysisStatus,
  AnalyzeRequest,
  ChordAnalysisMode,
  DerivedChords,
  WorkerResponse,
} from "../types";

export interface UseAnalysis {
  status: AnalysisStatus;
  analyzeFile: (file: File) => Promise<void>;
  reset: () => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useAnalysis(): UseAnalysis {
  const [status, setStatus] = useState<AnalysisStatus>({ state: "idle" });
  const workerRef = useRef<Worker | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const cleanupWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const revokeUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    cleanupWorker();
    revokeUrl();
    setStatus({ state: "idle" });
  }, [cleanupWorker, revokeUrl]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      cleanupWorker();
      revokeUrl();
    };
  }, [cleanupWorker, revokeUrl]);

  const analyzeFile = useCallback(
    async (file: File) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      cleanupWorker();
      revokeUrl();

      const audioUrl = URL.createObjectURL(file);
      objectUrlRef.current = audioUrl;

      setStatus({ state: "loading", stage: "decoding", progress: 0, fileName: file.name });

      let decoded: Awaited<ReturnType<typeof decodeAudioMono>>;
      try {
        decoded = await decodeAudioMono(file);
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        console.error("[chord-finder] Failed to decode audio:", error);
        revokeUrl();
        setStatus({
          state: "error",
          message: `This browser couldn't decode "${file.name}" (${describeError(error)}). MP3, WAV, and M4A work everywhere; OGG and AIFF support varies by browser.`,
        });
        return;
      }

      // Decoding cannot be aborted reliably across browsers. Ignore a stale
      // completion if the user reset the app or chose another file meanwhile.
      if (requestId !== requestIdRef.current) return;

      const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (requestId !== requestIdRef.current) {
          worker.terminate();
          return;
        }
        const message = event.data;
        if (message.type === "progress") {
          setStatus({
            state: "loading",
            stage: message.stage,
            progress: message.progress,
            fileName: file.name,
          });
        } else if (message.type === "result") {
          setStatus({ state: "ready", fileName: file.name, sourceFile: file, audioUrl, result: message.result });
          cleanupWorker();
        } else if (message.type === "chord-result") {
          revokeUrl();
          setStatus({ state: "error", message: "The analysis worker returned an unexpected result." });
          cleanupWorker();
        } else {
          revokeUrl();
          setStatus({ state: "error", message: message.message });
          cleanupWorker();
        }
      };

      worker.onerror = (event) => {
        if (requestId !== requestIdRef.current) return;
        revokeUrl();
        setStatus({ state: "error", message: event.message || "Analysis failed." });
        cleanupWorker();
      };

      const request: AnalyzeRequest = {
        mode: "full",
        channelData: decoded.channelData,
        sampleRate: SESSION_SAMPLE_RATE,
        durationSec: decoded.durationSec,
      };
      worker.postMessage(request, [request.channelData.buffer]);
    },
    [cleanupWorker, revokeUrl],
  );

  return { status, analyzeFile, reset };
}

export interface ChordBlobOptions {
  /** The master beat grid, so a stem's chords stay aligned to the song. */
  beats: number[];
  /** Track name recorded in the returned provenance. */
  source: string;
  analysisMode?: ChordAnalysisMode;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

/**
 * Analyze harmony for an aligned stem while preserving the master beat grid.
 *
 * Resolves to the segments *and* the record of which decoder produced them.
 * Callers must store the pair: `analysisMode` is not recoverable from the
 * segments, and re-deriving it from the current selection is what used to let
 * root-only output be presented as editable chords.
 */
export async function analyzeChordBlob(
  blob: Blob,
  { beats, source, analysisMode = "harmony", onProgress, signal }: ChordBlobOptions,
): Promise<DerivedChords> {
  const decoded = await decodeAudioMono(blob);
  if (signal?.aborted) throw new DOMException("Chord analysis cancelled", "AbortError");

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("Chord analysis cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress?.(message.progress);
      } else if (message.type === "chord-result") {
        finish();
        resolve({ segments: message.segments, provenance: message.provenance });
      } else if (message.type === "error") {
        finish();
        reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Stem chord analysis failed."));
    };
    const request: AnalyzeRequest = {
      mode: "chords",
      analysisMode,
      source,
      channelData: decoded.channelData,
      sampleRate: SESSION_SAMPLE_RATE,
      durationSec: decoded.durationSec,
      beats,
    };
    worker.postMessage(request, [request.channelData.buffer]);
  });
}
