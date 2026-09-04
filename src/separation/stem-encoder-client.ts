export interface EncodedStem {
  name: string;
  blob: Blob;
}

type EncoderMessage =
  | { type: "stem"; index: number; name: string; blob: Blob }
  | { type: "done" }
  | { type: "error"; error: string };

export class StemEncoderClient {
  private readonly worker: Worker;
  private rejectPending: ((error: Error) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("./stem-encoder.worker.ts", import.meta.url), { type: "module" });
  }

  encode({
    audio,
    stemNames,
    nSamples,
    numStems,
    sampleRate,
    onProgress,
  }: {
    audio: Float32Array;
    stemNames: string[];
    nSamples: number;
    numStems: number;
    sampleRate: number;
    onProgress: (complete: number, total: number) => void;
  }): Promise<EncodedStem[]> {
    return new Promise((resolve, reject) => {
      const stems: Array<EncodedStem | undefined> = new Array(numStems);
      this.rejectPending = reject;

      this.worker.onmessage = (event: MessageEvent<EncoderMessage>) => {
        const message = event.data;
        if (message.type === "error") {
          this.rejectPending = null;
          reject(new Error(message.error));
          return;
        }
        if (message.type === "stem") {
          stems[message.index] = { name: message.name, blob: message.blob };
          onProgress(stems.filter(Boolean).length, numStems);
          return;
        }
        const complete = stems.every((stem): stem is EncodedStem => stem !== undefined);
        this.rejectPending = null;
        if (!complete) {
          reject(new Error("The stem encoder returned an incomplete result."));
          return;
        }
        resolve(stems as EncodedStem[]);
      };
      this.worker.onerror = (event) => {
        this.rejectPending = null;
        reject(new Error(event.message || "The stem encoder stopped unexpectedly."));
      };

      this.worker.postMessage(
        { type: "encode", audio, stemNames, nSamples, numStems, sampleRate },
        [audio.buffer],
      );
    });
  }

  terminate(reason = "Stem encoding cancelled"): void {
    this.worker.terminate();
    this.rejectPending?.(new DOMException(reason, "AbortError"));
    this.rejectPending = null;
  }
}
