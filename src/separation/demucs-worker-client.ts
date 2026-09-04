export interface DemucsProgressEvent {
  type: "chunk_started" | "chunk_done";
  index: number;
  total: number;
}

export interface DemucsResult {
  audio: Float32Array;
  stemNames: string[];
  nSamples: number;
  numStems: number;
}

interface WorkerMessage {
  id?: number;
  type: string;
  error?: string;
  event?: DemucsProgressEvent;
  audio?: Float32Array;
  stemNames?: string[];
  nSamples?: number;
  numStems?: number;
}

interface PendingRequest {
  resolve: (message: WorkerMessage) => void;
  reject: (error: Error) => void;
}

export class DemucsWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;
  private progress: ((event: DemucsProgressEvent) => void) | null = null;

  constructor() {
    const workerUrl = new URL("vendor/demucs/worker.js", document.baseURI);
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress" && message.event) {
        this.progress?.(message.event);
        return;
      }
      if (message.id === undefined) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.type === "error") request.reject(new Error(message.error ?? "Separation failed."));
      else request.resolve(message);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "The separation worker stopped unexpectedly.");
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
  }

  private send(type: string, data: Record<string, unknown>, transfer: Transferable[] = []): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...data }, transfer);
    });
  }

  async initialize(): Promise<void> {
    const wasmUrl = new URL("vendor/demucs/demucs_wasm_bg.wasm", document.baseURI).href;
    await this.send("init", { wasmUrl });
  }

  async separate({
    modelBytes,
    left,
    right,
    sampleRate,
    stems,
    onProgress,
  }: {
    modelBytes: Uint8Array;
    left: Float32Array;
    right: Float32Array;
    sampleRate: number;
    stems: string[];
    onProgress: (event: DemucsProgressEvent) => void;
  }): Promise<DemucsResult> {
    this.progress = onProgress;
    const message = await this.send(
      "separate",
      { modelBytes, modelId: "htdemucs_6s", stems, left, right, sampleRate },
      [modelBytes.buffer, left.buffer, right.buffer],
    );
    this.progress = null;
    if (
      !message.audio ||
      !message.stemNames ||
      message.nSamples === undefined ||
      message.numStems === undefined
    ) {
      throw new Error("The separator returned an incomplete result.");
    }
    return {
      audio: message.audio,
      stemNames: message.stemNames,
      nSamples: message.nSamples,
      numStems: message.numStems,
    };
  }

  terminate(reason = "Separation cancelled"): void {
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new DOMException(reason, "AbortError"));
    this.pending.clear();
  }
}

