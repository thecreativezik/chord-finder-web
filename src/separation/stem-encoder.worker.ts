import { encodeStereoWav } from "../audio/wav";

interface EncodeRequest {
  type: "encode";
  audio: Float32Array;
  stemNames: string[];
  nSamples: number;
  numStems: number;
  sampleRate: number;
}

type EncoderResponse =
  | { type: "stem"; index: number; name: string; blob: Blob }
  | { type: "done" }
  | { type: "error"; error: string };

const worker = self as DedicatedWorkerGlobalScope;

function send(message: EncoderResponse, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

worker.onmessage = (event: MessageEvent<EncodeRequest>) => {
  const request = event.data;
  if (request.type !== "encode") return;

  try {
    const expectedSamples = request.nSamples * request.numStems * 2;
    if (
      !Number.isSafeInteger(expectedSamples) ||
      request.nSamples <= 0 ||
      request.numStems <= 0 ||
      request.audio.length !== expectedSamples
    ) {
      throw new Error("The separator returned an invalid audio layout.");
    }

    for (let index = 0; index < request.numStems; index += 1) {
      const offset = index * 2 * request.nSamples;
      const left = request.audio.subarray(offset, offset + request.nSamples);
      const right = request.audio.subarray(offset + request.nSamples, offset + request.nSamples * 2);
      const wav = encodeStereoWav(left, right, request.sampleRate);
      send({
        type: "stem",
        index,
        name: request.stemNames[index] ?? `stem-${index + 1}`,
        blob: new Blob([wav], { type: "audio/wav" }),
      });
    }
    send({ type: "done" });
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
