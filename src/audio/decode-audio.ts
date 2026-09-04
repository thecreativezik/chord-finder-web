export const SESSION_SAMPLE_RATE = 44_100;

export interface DecodedStereo {
  left: Float32Array;
  right: Float32Array;
  durationSec: number;
  sampleRate: number;
}

async function decode(blob: Blob): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
}

async function resample(decoded: AudioBuffer, channels: 1 | 2): Promise<AudioBuffer> {
  const frameCount = Math.max(1, Math.ceil(decoded.duration * SESSION_SAMPLE_RATE));
  const offline = new OfflineAudioContext(channels, frameCount, SESSION_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

export async function decodeAudioMono(blob: Blob): Promise<{
  channelData: Float32Array;
  durationSec: number;
}> {
  const rendered = await resample(await decode(blob), 1);
  return {
    channelData: rendered.getChannelData(0).slice(),
    durationSec: rendered.duration,
  };
}

export async function decodeAudioStereo(blob: Blob): Promise<DecodedStereo> {
  const rendered = await resample(await decode(blob), 2);
  return {
    left: rendered.getChannelData(0).slice(),
    right: rendered.getChannelData(1).slice(),
    durationSec: rendered.duration,
    sampleRate: SESSION_SAMPLE_RATE,
  };
}

