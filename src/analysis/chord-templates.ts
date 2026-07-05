// Builds the chroma template bank used by the chord classifier.
//
// Each chord becomes a 12-bin pitch-class template. The root is weighted higher
// than the other chord tones so that enharmonically-identical sets (e.g. C6 vs
// Am7, which share the same four pitch classes) are disambiguated toward
// whichever root carries more energy in the signal.

import { buildChordVocabulary, type ChordEntry } from "./chord-vocabulary";

const ROOT_WEIGHT = 1.45;
const TONE_WEIGHT = 1.0;

export interface ChordTemplate extends ChordEntry {
  vector: Float32Array; // L2-normalized 12-bin template
}

function l2Normalize(vector: Float32Array): void {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
}

let cached: ChordTemplate[] | null = null;

/** The full template bank (built once, then cached). */
export function buildTemplates(): ChordTemplate[] {
  if (cached) return cached;
  cached = buildChordVocabulary().map((entry) => {
    const vector = new Float32Array(12);
    for (const pc of entry.pitchClasses) {
      vector[pc] = pc === entry.rootPc ? ROOT_WEIGHT : TONE_WEIGHT;
    }
    l2Normalize(vector);
    return { ...entry, vector };
  });
  return cached;
}
