import { useCallback, useEffect, useRef } from "react";

interface Voice {
  midi: number;
  oscillators: OscillatorNode[];
  auxiliaryNodes: AudioNode[];
  gain: GainNode;
}

export type PianoVoiceId = string | number;

export interface PianoSynth {
  noteOn: (midi: number, voiceId?: PianoVoiceId) => void;
  noteOff: (midi: number, voiceId?: PianoVoiceId) => void;
  allNotesOff: () => void;
}

function midiFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A small, warm Web Audio piano-like synth for the interactive keyboard. */
export function usePianoSynth(): PianoSynth {
  const contextRef = useRef<AudioContext | null>(null);
  const outputRef = useRef<GainNode | null>(null);
  const voicesRef = useRef(new Map<string, Voice>());

  const voiceKey = (midi: number, voiceId?: PianoVoiceId) => voiceId === undefined
    ? `midi:${midi}`
    : `${typeof voiceId}:${voiceId}`;

  const ensureContext = useCallback(() => {
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    if (!outputRef.current) {
      const output = context.createGain();
      output.gain.value = 0.38;
      output.connect(context.destination);
      outputRef.current = output;
    }
    if (context.state === "suspended") void context.resume();
    return context;
  }, []);

  const releaseVoice = useCallback((key: string, voice: Voice) => {
    voicesRef.current.delete(key);
    const now = voice.gain.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.08);
    for (const oscillator of voice.oscillators) oscillator.stop(now + 0.45);
    window.setTimeout(() => {
      for (const oscillator of voice.oscillators) oscillator.disconnect();
      for (const node of voice.auxiliaryNodes) node.disconnect();
      voice.gain.disconnect();
    }, 500);
  }, []);

  const noteOff = useCallback((midi: number, voiceId?: PianoVoiceId) => {
    if (voiceId !== undefined) {
      const key = voiceKey(midi, voiceId);
      const voice = voicesRef.current.get(key);
      if (voice) releaseVoice(key, voice);
      return;
    }
    for (const [key, voice] of Array.from(voicesRef.current.entries())) {
      if (voice.midi === midi) releaseVoice(key, voice);
    }
  }, [releaseVoice]);

  const noteOn = useCallback((midi: number, voiceId?: PianoVoiceId) => {
    if (!Number.isFinite(midi)) return;
    const key = voiceKey(midi, voiceId);
    const existing = voicesRef.current.get(key);
    if (existing) releaseVoice(key, existing);
    const context = ensureContext();
    const output = outputRef.current;
    if (!output) return;

    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.62, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.32);
    gain.connect(output);

    const frequency = midiFrequency(midi);
    const fundamental = context.createOscillator();
    fundamental.type = "triangle";
    fundamental.frequency.value = frequency;
    fundamental.connect(gain);

    const overtoneGain = context.createGain();
    overtoneGain.gain.value = 0.12;
    overtoneGain.connect(gain);
    const overtone = context.createOscillator();
    overtone.type = "sine";
    overtone.frequency.value = frequency * 2.003;
    overtone.connect(overtoneGain);

    fundamental.start(now);
    overtone.start(now);
    voicesRef.current.set(key, {
      midi,
      oscillators: [fundamental, overtone],
      auxiliaryNodes: [overtoneGain],
      gain,
    });
  }, [ensureContext, releaseVoice]);

  const allNotesOff = useCallback(() => {
    for (const [key, voice] of Array.from(voicesRef.current.entries())) releaseVoice(key, voice);
  }, [releaseVoice]);

  useEffect(() => {
    const voices = voicesRef.current;
    return () => {
      for (const voice of voices.values()) {
        for (const oscillator of voice.oscillators) {
          try {
            oscillator.stop();
          } catch {
            // Already stopped.
          }
          oscillator.disconnect();
        }
        for (const node of voice.auxiliaryNodes) node.disconnect();
        voice.gain.disconnect();
      }
      voices.clear();
      outputRef.current?.disconnect();
      outputRef.current = null;
      const context = contextRef.current;
      contextRef.current = null;
      if (context) void context.close();
    };
  }, []);

  return { noteOn, noteOff, allNotesOff };
}
