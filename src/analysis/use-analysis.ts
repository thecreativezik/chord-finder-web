// Hook that decodes an audio file, runs analysis in a Web Worker, and exposes
// progress + results. A fresh worker is created per file and terminated when
// done, which frees the essentia WASM heap without manual vector bookkeeping.
//
// Web version: files come exclusively from the browser (picker or drag-drop)
// as File objects — no native picker / custom protocol like the macOS app.

import { useCallback, useEffect, useRef, useState } from "react";

import type { AnalysisStatus, AnalyzeRequest, WorkerResponse } from "../types";

const TARGET_SAMPLE_RATE = 44100;

interface DecodedAudio {
  channelData: Float32Array;
  durationSec: number;
}

async function decodeToMono(arrayBuffer: ArrayBuffer): Promise<DecodedAudio> {
  const decodeContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    await decodeContext.close();
  }

  // Resample to a fixed 44.1kHz mono buffer so the worker can rely on
  // essentia's default sample rate, and stereo is downmixed automatically.
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return {
    channelData: rendered.getChannelData(0).slice(),
    durationSec: rendered.duration,
  };
}

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
    cleanupWorker();
    revokeUrl();
    setStatus({ state: "idle" });
  }, [cleanupWorker, revokeUrl]);

  useEffect(() => {
    return () => {
      cleanupWorker();
      revokeUrl();
    };
  }, [cleanupWorker, revokeUrl]);

  const analyzeFile = useCallback(
    async (file: File) => {
      cleanupWorker();
      revokeUrl();

      const audioUrl = URL.createObjectURL(file);
      objectUrlRef.current = audioUrl;

      setStatus({ state: "loading", stage: "decoding", progress: 0, fileName: file.name });

      let decoded: DecodedAudio;
      try {
        decoded = await decodeToMono(await file.arrayBuffer());
      } catch (error) {
        console.error("[chord-finder] Failed to decode audio:", error);
        revokeUrl();
        setStatus({
          state: "error",
          message: `This browser couldn't decode "${file.name}" (${describeError(error)}). MP3, WAV, and M4A work everywhere; OGG and AIFF support varies by browser.`,
        });
        return;
      }

      const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === "progress") {
          setStatus({
            state: "loading",
            stage: message.stage,
            progress: message.progress,
            fileName: file.name,
          });
        } else if (message.type === "result") {
          setStatus({ state: "ready", fileName: file.name, audioUrl, result: message.result });
          cleanupWorker();
        } else {
          setStatus({ state: "error", message: message.message });
          cleanupWorker();
        }
      };

      worker.onerror = (event) => {
        setStatus({ state: "error", message: event.message || "Analysis failed." });
        cleanupWorker();
      };

      const request: AnalyzeRequest = {
        channelData: decoded.channelData,
        sampleRate: TARGET_SAMPLE_RATE,
        durationSec: decoded.durationSec,
      };
      worker.postMessage(request, [request.channelData.buffer]);
    },
    [cleanupWorker, revokeUrl],
  );

  return { status, analyzeFile, reset };
}
