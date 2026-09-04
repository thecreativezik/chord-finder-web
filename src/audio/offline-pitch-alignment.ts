import { estimateSoundTouchSourceLatencySec } from "./soundtouch-config";

export interface OfflinePitchAlignmentPlan {
  /** Delay measured on the uploaded song's timeline. */
  sourceLatencySec: number;
  /** The same delay after converting through playbackRate to rendered time. */
  outputLatencySec: number;
  /** Silent source frames appended so SoundTouch can emit the original tail. */
  sourcePaddingFrames: number;
  /** Delayed output frames removed from the rendered prefix. */
  outputCropStartFrame: number;
  /** Exact number of frames retained in the final rendered file. */
  outputFrameCount: number;
  paddedInputFrameCount: number;
}

/**
 * Plan padding/cropping for SoundTouch's non-causal lookahead. Source frames
 * and rendered output frames differ when playbackRate is not 1, so conversions
 * are explicit even though mix export currently renders at exactly 1×.
 */
export function planOfflinePitchAlignment(
  sourceFrameCount: number,
  pitchSemitones: number,
  sampleRate: number,
  playbackRate = 1,
): OfflinePitchAlignmentPlan {
  const safeSourceFrames = Math.max(1, Math.floor(sourceFrameCount));
  const safeSampleRate = Math.max(1, sampleRate);
  const safeRate = Math.max(0.1, Math.min(8, playbackRate));
  const sourceLatencySec = estimateSoundTouchSourceLatencySec(
    pitchSemitones,
    safeRate,
    safeSampleRate,
  );
  const outputLatencySec = sourceLatencySec / safeRate;
  const sourcePaddingFrames = Math.ceil(sourceLatencySec * safeSampleRate);
  const outputCropStartFrame = Math.ceil(outputLatencySec * safeSampleRate);
  const outputFrameCount = Math.ceil(safeSourceFrames / safeRate);

  return {
    sourceLatencySec,
    outputLatencySec,
    sourcePaddingFrames,
    outputCropStartFrame,
    outputFrameCount,
    paddedInputFrameCount: safeSourceFrames + sourcePaddingFrames,
  };
}

/** Crop delayed output to the intended length, zero-padding only if a browser
 * unexpectedly returns fewer frames than its OfflineAudioContext allocation. */
export function cropOfflinePitchChannel(
  rendered: Float32Array,
  plan: Pick<OfflinePitchAlignmentPlan, "outputCropStartFrame" | "outputFrameCount">,
): Float32Array<ArrayBuffer> {
  const output = new Float32Array(plan.outputFrameCount);
  const available = Math.max(0, Math.min(
    plan.outputFrameCount,
    rendered.length - plan.outputCropStartFrame,
  ));
  if (available > 0) {
    output.set(rendered.subarray(
      plan.outputCropStartFrame,
      plan.outputCropStartFrame + available,
    ));
  }
  return output;
}
