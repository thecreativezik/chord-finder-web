// Arrangement detection: where the song repeats itself.
//
// This is Foote's 1999/2000 self-similarity method, unchanged and on purpose.
// It needs no model, no network, and no second pass over the audio: the chord
// decoder already averages chroma into beat windows, so the features are a
// by-product of work we do anyway.
//
//   beat-synchronous features -> cosine self-similarity matrix
//     -> checkerboard-kernel novelty curve -> peak-pick -> snap to downbeats
//     -> group repeats into A / B / A2 labels
//
// What it deliberately does not do is name a region "Chorus". A similarity
// read supports "this part comes back"; it does not support "this part is the
// chorus". Letters are what the maths earns, and the musician renames the rest.

import { averageChromaForWindow, buildAnalysisWindows, type AnalysisWindow } from "./classify-chords";
import { DEFAULT_TIME_SIGNATURE, normalizeBeats, snapToDownbeat } from "./beat-map";
import type { SectionSegment, TimeSignature } from "../types";

/** Below this many beat windows there is not enough structure to read. */
const MIN_WINDOWS = 16;
/** Songs shorter than this are practice loops, not arrangements. */
const MIN_DURATION_SEC = 20;
/** Similarity matrix cap. Past this we stride-average; see PERFORMANCE below. */
const MAX_WINDOWS = 2_000;
/** Shortest section we will emit, in bars. Shorter candidates fold forwards. */
const MIN_SECTION_BARS = 4;
/**
 * Checkerboard kernel half-width, in bars.
 *
 * This has to be *wider than the harmonic loop* or the kernel reports every
 * chord change as a section boundary — a four-bar I-IV-V-I turnaround read with
 * a two-bar kernel looks exactly like structure. Eight bars either side means
 * the kernel compares one phrase against the next rather than one chord against
 * the next.
 */
const KERNEL_BARS = 8;
const KERNEL_MIN_HALF_WIDTH = 8;
const KERNEL_MAX_HALF_WIDTH = 96;
/** A song has to be at least this many kernels long for the kernel to fit. */
const KERNEL_SPAN_DIVISOR = 5;
/** Novelty peaks must clear mean + this many standard deviations to be proposed. */
const PEAK_THRESHOLD_SIGMA = 1;
/**
 * Cosine similarity above which two adjacent candidate sections are really one
 * section. Novelty *proposes* a boundary; this *confirms* it. Without the
 * confirmation step a song that loops one progression start to finish gets
 * chopped into phrases, because after normalising the novelty curve to its own
 * maximum the tallest ripple in a flat curve still looks like a peak.
 */
const BOUNDARY_CONTRAST = 0.985;
/** Cosine similarity at which two sections are called the same section. */
const REPEAT_SIMILARITY = 0.92;
/**
 * Weight of the loudness dimension relative to the twelve chroma dimensions.
 * Chroma alone cannot separate a quiet verse from a loud chorus built on the
 * same four chords, which is a very common shape; a single coarse loudness
 * dimension separates them without pretending to be a timbre model.
 */
const LOUDNESS_WEIGHT = 0.6;

const FEATURE_SIZE = 13; // 12 chroma + 1 loudness

export interface DetectSectionsInput {
  frames: Float32Array[]; // C-indexed chroma per frame
  frameTimes: number[]; // start time (sec) of each frame
  beats: number[]; // beat times (sec); may be empty
  durationSec: number;
  timeSignature?: TimeSignature;
  /** Downbeat times used to quantise boundaries. Omit to leave them unquantised. */
  downbeats?: readonly number[];
}

/**
 * Beat windows collapsed to at most MAX_WINDOWS blocks.
 *
 * PERFORMANCE: the similarity matrix is O(N^2) in blocks. A five-minute song at
 * 120 BPM is ~600 beats, so a 600x600 matrix — 1.4 MB and a few million
 * 13-dimensional dot products, comfortably inside the 250 ms budget. A long DJ
 * mix would blow that quadratically, so past the cap we average whole groups of
 * beats into one block and accept coarser boundaries rather than freezing the
 * worker.
 */
function blockWindows(windows: AnalysisWindow[]): AnalysisWindow[] {
  if (windows.length <= MAX_WINDOWS) return windows;
  const stride = Math.ceil(windows.length / MAX_WINDOWS);
  const blocks: AnalysisWindow[] = [];
  for (let i = 0; i < windows.length; i += stride) {
    const end = Math.min(i + stride, windows.length) - 1;
    blocks.push({ start: windows[i].start, end: windows[end].end });
  }
  return blocks;
}

/**
 * One L2-normalised feature vector per block: twelve chroma dimensions plus a
 * log-compressed loudness dimension scaled across the song.
 */
function buildFeatures(
  frames: Float32Array[],
  frameTimes: number[],
  blocks: AnalysisWindow[],
): Float32Array[] {
  const chromas: Float32Array[] = [];
  const energies = new Float64Array(blocks.length);

  for (let i = 0; i < blocks.length; i++) {
    const chroma = averageChromaForWindow(frames, frameTimes, blocks[i].start, blocks[i].end);
    chromas.push(chroma);
    let energy = 0;
    for (let b = 0; b < 12; b++) energy += chroma[b];
    energies[i] = Math.log1p(Math.max(0, energy));
  }

  let peakEnergy = 0;
  for (const energy of energies) peakEnergy = Math.max(peakEnergy, energy);

  return chromas.map((chroma, i) => {
    const feature = new Float32Array(FEATURE_SIZE);
    let sumSq = 0;
    for (let b = 0; b < 12; b++) sumSq += chroma[b] * chroma[b];
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let b = 0; b < 12; b++) feature[b] = chroma[b] / norm;
    }
    feature[12] = peakEnergy > 0 ? LOUDNESS_WEIGHT * (energies[i] / peakEnergy) : 0;

    let total = 0;
    for (let b = 0; b < FEATURE_SIZE; b++) total += feature[b] * feature[b];
    const featureNorm = Math.sqrt(total);
    if (featureNorm > 0) {
      for (let b = 0; b < FEATURE_SIZE; b++) feature[b] /= featureNorm;
    }
    return feature;
  });
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Foote checkerboard kernel: +1 inside the two self-similar quadrants, -1
 * inside the two cross quadrants, tapered by a Gaussian so blocks near the
 * centre dominate. Correlated along the diagonal of the similarity matrix it
 * peaks exactly where one homogeneous block gives way to another.
 */
function buildKernel(halfWidth: number): Float32Array {
  const size = halfWidth * 2;
  const kernel = new Float32Array(size * size);
  const sigma = halfWidth / 2;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dRow = row - halfWidth + 0.5;
      const dCol = col - halfWidth + 0.5;
      const taper = Math.exp(-(dRow * dRow + dCol * dCol) / (2 * sigma * sigma));
      const sameQuadrant = dRow * dCol > 0;
      kernel[row * size + col] = (sameQuadrant ? 1 : -1) * taper;
    }
  }
  return kernel;
}

/**
 * Novelty curve over the similarity matrix, normalised to 0..1.
 *
 * Only the interior is computed: within `halfWidth` of either end the kernel
 * runs off the matrix, and a partial kernel there produces a phantom boundary
 * at the first and last bar of every song.
 */
function noveltyCurve(features: Float32Array[], halfWidth: number): Float64Array {
  const count = features.length;
  const novelty = new Float64Array(count);
  const kernel = buildKernel(halfWidth);
  const size = halfWidth * 2;

  // Cache the similarity matrix once; each block is read by up to 2*halfWidth
  // kernel positions, so recomputing the cosines would dominate the runtime.
  const similarity: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const row = new Float32Array(count);
    for (let j = 0; j < count; j++) row[j] = cosine(features[i], features[j]);
    similarity.push(row);
  }

  for (let centre = halfWidth; centre < count - halfWidth; centre++) {
    let sum = 0;
    for (let row = 0; row < size; row++) {
      const similarityRow = similarity[centre - halfWidth + row];
      for (let col = 0; col < size; col++) {
        sum += kernel[row * size + col] * similarityRow[centre - halfWidth + col];
      }
    }
    novelty[centre] = Math.max(0, sum);
  }

  let peak = 0;
  for (const value of novelty) peak = Math.max(peak, value);
  if (peak > 0) {
    for (let i = 0; i < count; i++) novelty[i] /= peak;
  }
  return novelty;
}

/** Local maxima clearing the threshold, greedily thinned by `minDistance`. */
function pickPeaks(novelty: Float64Array, minDistance: number, halfWidth: number): number[] {
  const interior: number[] = [];
  for (let i = halfWidth; i < novelty.length - halfWidth; i++) interior.push(i);
  if (interior.length === 0) return [];

  let sum = 0;
  for (const i of interior) sum += novelty[i];
  const mean = sum / interior.length;
  let variance = 0;
  for (const i of interior) variance += (novelty[i] - mean) ** 2;
  const deviation = Math.sqrt(variance / interior.length);
  const threshold = mean + PEAK_THRESHOLD_SIGMA * deviation;

  const candidates = interior
    .filter((i) => {
      if (novelty[i] < threshold || novelty[i] <= 0) return false;
      const from = Math.max(0, i - minDistance);
      const to = Math.min(novelty.length - 1, i + minDistance);
      for (let j = from; j <= to; j++) {
        if (j !== i && novelty[j] > novelty[i]) return false;
      }
      return true;
    })
    // Strongest first, so a thinned-out weaker neighbour never displaces a peak.
    .sort((a, b) => novelty[b] - novelty[a]);

  const peaks: number[] = [];
  for (const candidate of candidates) {
    if (peaks.every((peak) => Math.abs(peak - candidate) >= minDistance)) peaks.push(candidate);
  }
  return peaks.sort((a, b) => a - b);
}

/** Mean of a block range, L2-normalised — the signature used to group repeats. */
function sectionSignature(features: Float32Array[], from: number, to: number): Float32Array {
  const mean = new Float32Array(FEATURE_SIZE);
  const count = Math.max(1, to - from);
  for (let i = from; i < to; i++) {
    const feature = features[i];
    for (let b = 0; b < FEATURE_SIZE; b++) mean[b] += feature[b];
  }
  let sumSq = 0;
  for (let b = 0; b < FEATURE_SIZE; b++) {
    mean[b] /= count;
    sumSq += mean[b] * mean[b];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let b = 0; b < FEATURE_SIZE; b++) mean[b] /= norm;
  }
  return mean;
}

function clampTime(time: number, durationSec: number): number {
  return Math.min(durationSec, Math.max(0, time));
}

function letterFor(index: number): string {
  // A..Z, then AA, AB… so a pathological arrangement still gets unique labels.
  let label = "";
  let remaining = index;
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

/**
 * Read the arrangement of a song from the chroma the chord decoder already
 * computed. Returns `[]` — not an error — whenever the song is too short or too
 * sparsely tracked to say anything honest about its structure.
 */
export function detectSections(input: DetectSectionsInput): SectionSegment[] {
  const { frames, frameTimes, durationSec } = input;
  const signature = input.timeSignature ?? DEFAULT_TIME_SIGNATURE;
  const beatsPerBar = Math.max(1, Math.round(signature.beatsPerBar));
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SEC) return [];

  const beats = normalizeBeats(input.beats);
  const windows = buildAnalysisWindows(beats, durationSec);
  if (windows.length < MIN_WINDOWS) return [];

  const blocks = blockWindows(windows);
  const blocksPerWindow = blocks.length / windows.length;
  const features = buildFeatures(frames, frameTimes, blocks);

  const barsInBlocks = Math.max(1, Math.round(beatsPerBar * blocksPerWindow));
  const halfWidth = Math.min(
    KERNEL_MAX_HALF_WIDTH,
    Math.floor(blocks.length / KERNEL_SPAN_DIVISOR),
    Math.max(KERNEL_MIN_HALF_WIDTH, Math.round(KERNEL_BARS * barsInBlocks)),
  );
  // Two kernels plus a bar of margin have to fit, or every position is an edge.
  if (halfWidth < KERNEL_MIN_HALF_WIDTH || blocks.length < halfWidth * 2 + barsInBlocks) return [];

  const novelty = noveltyCurve(features, halfWidth);
  const minDistance = Math.max(halfWidth, MIN_SECTION_BARS * barsInBlocks);
  const peaks = pickPeaks(novelty, minDistance, halfWidth);
  if (peaks.length === 0) return [];

  // ── Confirm each proposed boundary ────────────────────────────────────
  // Repeatedly drop the boundary whose two sides are most alike, until every
  // surviving boundary separates two genuinely different sections. This is what
  // stops a song that loops one progression from being chopped into phrases.
  const bounds = [0, ...peaks, blocks.length];
  while (bounds.length > 2) {
    let weakest = -1;
    let weakestContrast = -Infinity;
    for (let i = 1; i < bounds.length - 1; i++) {
      const before = sectionSignature(features, bounds[i - 1], bounds[i]);
      const after = sectionSignature(features, bounds[i], bounds[i + 1]);
      const similarity = cosine(before, after);
      if (similarity > weakestContrast) {
        weakestContrast = similarity;
        weakest = i;
      }
    }
    if (weakest < 0 || weakestContrast < BOUNDARY_CONTRAST) break;
    bounds.splice(weakest, 1);
  }
  // One section is not an arrangement; show nothing rather than a single block.
  if (bounds.length <= 2) return [];

  // ── Enforce the minimum section length ───────────────────────────────
  // Done in block space and forwards, so a too-short *opening* section folds
  // into the one after it. Folding only backwards would leave the first section
  // permanently exempt from the minimum, which is what produced a stray
  // four-second "section A" at the head of every song.
  const minBlocks = Math.max(1, Math.round(MIN_SECTION_BARS * barsInBlocks));
  const kept = [bounds[0]];
  for (let i = 1; i < bounds.length - 1; i++) {
    if (bounds[i] - kept[kept.length - 1] >= minBlocks) kept.push(bounds[i]);
  }
  // The closing section has no successor to fold into, so drop the boundary
  // that opened it instead.
  while (kept.length > 1 && blocks.length - kept[kept.length - 1] < minBlocks) kept.pop();
  if (kept.length < 2) return [];
  kept.push(blocks.length);

  // ── Emit, grouping repeats into letters ──────────────────────────────
  // Greedy against cluster signatures in playing order, which keeps the
  // first-heard part as "A" the way a musician would letter a chart.
  const clusters: { signature: Float32Array; letter: string; count: number }[] = [];
  const sections: SectionSegment[] = [];

  for (let i = 0; i < kept.length - 1; i++) {
    const startBlock = kept[i];
    const endBlock = kept[i + 1];
    const startSec = startBlock === 0
      ? 0
      : clampTime(snapToDownbeat(input.downbeats ?? [], blocks[startBlock].start), durationSec);
    const endSec = endBlock >= blocks.length
      ? durationSec
      : clampTime(snapToDownbeat(input.downbeats ?? [], blocks[endBlock].start), durationSec);
    if (endSec - startSec <= 0) continue;

    // The first section is opened by the start of the song rather than by a
    // detected boundary, so it reports the strength of the boundary that closes
    // it — the one that actually determined its extent.
    const confidence = startBlock === 0
      ? (endBlock < blocks.length ? novelty[endBlock] : 0)
      : novelty[startBlock];

    const signatureVector = sectionSignature(features, startBlock, endBlock);
    let match = -1;
    let bestScore = REPEAT_SIMILARITY;
    for (let c = 0; c < clusters.length; c++) {
      const score = cosine(signatureVector, clusters[c].signature);
      if (score >= bestScore) {
        bestScore = score;
        match = c;
      }
    }

    let label: string;
    if (match >= 0) {
      const cluster = clusters[match];
      cluster.count += 1;
      label = `${cluster.letter}${cluster.count}`;
    } else {
      const letter = letterFor(clusters.length);
      clusters.push({ signature: signatureVector, letter, count: 1 });
      label = letter;
    }

    sections.push({
      label,
      startSec,
      endSec,
      confidence: Math.max(0, Math.min(1, confidence)),
    });
  }

  // A lane with one block in it says nothing a musician cannot already see.
  return sections.length >= 2 ? sections : [];
}
