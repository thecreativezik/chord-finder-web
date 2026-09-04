/**
 * Fixed WSOLA windows keep the real-time and offline pitch engines consistent
 * and make their startup latency reproducible. SoundTouch's automatic windows
 * vary between 50–125 ms with tempo, which is unsuitable for a synced playhead.
 */
export const SOUND_TOUCH_STRETCH_PARAMETERS = {
  sequenceMs: 50,
  seekWindowMs: 15,
  overlapMs: 8,
  quickSeek: true,
} as const;

const AUDIO_RENDER_QUANTUM_FRAMES = 128;
const DEFAULT_SAMPLE_RATE = 44_100;

/**
 * True when the audio can take the zero-DSP-latency direct path. Native media
 * playback already preserves pitch when changing speed, so SoundTouch is only
 * needed for an actual key shift.
 */
export function isSoundTouchNeutral(pitchSemitones: number, _playbackRate: number): boolean {
  return Math.abs(pitchSemitones) < 0.001;
}

/**
 * Estimate SoundTouch's startup delay in source-timeline seconds.
 *
 * SoundTouch's Stretch stage first consumes one overlap window, then waits for
 * `sampleReq = max(nominalSkip + overlap, sequence) + seekWindow` input frames.
 * One Web Audio render quantum is included for worklet hand-off. Multiplying
 * the real-time delay by playbackRate converts it to the same source-time units
 * used by HTMLMediaElement.currentTime, chord regions, and detected beats.
 */
export function estimateSoundTouchSourceLatencySec(
  pitchSemitones: number,
  playbackRate: number,
  sampleRate = DEFAULT_SAMPLE_RATE,
): number {
  if (isSoundTouchNeutral(pitchSemitones, playbackRate)) return 0;

  const safeRate = Math.max(0.1, Math.min(8, playbackRate));
  const pitchRatio = 2 ** (pitchSemitones / 12);
  const stretchTempo = safeRate / pitchRatio;
  const { sequenceMs, seekWindowMs, overlapMs } = SOUND_TOUCH_STRETCH_PARAMETERS;
  const nominalSkipMs = stretchTempo * (sequenceMs - overlapMs);
  const sampleRequirementMs = Math.max(nominalSkipMs + overlapMs, sequenceMs) + seekWindowMs;
  const algorithmLatencyRealSec = (overlapMs + sampleRequirementMs) / 1_000;
  const workletQuantumRealSec = AUDIO_RENDER_QUANTUM_FRAMES / Math.max(1, sampleRate);
  return (algorithmLatencyRealSec + workletQuantumRealSec) * safeRate;
}
