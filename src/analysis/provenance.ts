// What produced a derived artifact.
//
// Deliberately narrow. This is not a general provenance bag: the app persists
// nothing but the cached separation model, so a field that is only read back
// after a reload would be decoration. What it records is the subset that is
// load-bearing inside one session — above all *which chord decoder ran*, which
// three user-visible behaviours depend on and which used to be re-derived from
// the currently selected track rather than from the data on screen.

import type { ChordAnalysisMode, Provenance } from "../types";

/**
 * Pinned engine identity for the analysis worker. The version is duplicated
 * from `package.json` on purpose and `tests/provenance.test.ts` asserts it
 * against the installed package, so a dependency bump fails the suite instead
 * of silently mislabelling every artifact produced after it.
 */
export const CHORD_ENGINE = "essentia.js@0.1.3+viterbi";

export const ORIGINAL_MIX_SOURCE = "Original mix";

/** Engine identity for a separation run, keyed to the pinned model revision. */
export function stemSeparationEngine(modelRevision: string): string {
  return `htdemucs_6s@${modelRevision.slice(0, 8)}`;
}

export interface ProvenanceInput {
  module: Provenance["module"];
  source: string;
  engine: string;
  params?: Provenance["params"];
  /** `Date.now()` captured before the work started. */
  startedAt: number;
  /** Defaults to now, so callers only have to remember the start. */
  finishedAt?: number;
}

export function createProvenance({
  module,
  source,
  engine,
  params,
  startedAt,
  finishedAt = Date.now(),
}: ProvenanceInput): Provenance {
  return {
    module,
    source,
    engine,
    ...(params ? { params } : null),
    startedAt,
    durationMs: Math.max(0, Math.round(finishedAt - startedAt)),
  };
}

/**
 * True when the artifact was decoded by `classifyBassRoots` rather than
 * `classifyChords`, so it carries one pitch-class root per beat window and
 * cannot be edited as a chord symbol.
 *
 * Read this off the provenance of the segments being rendered — never off the
 * currently selected track. The two disagree for a render after the source
 * track is removed from the mixer.
 */
export function isRootOnly(provenance: Provenance | null | undefined): boolean {
  return provenance?.params?.decoder === "bass-root";
}

export function chordDecoderParams(
  analysisMode: ChordAnalysisMode,
  tuningHz: number,
): Provenance["params"] {
  return { decoder: analysisMode, tuningHz: Math.round(tuningHz * 10) / 10 };
}

/** One-line attribution for a tooltip: "Bass · htdemucs_6s@93972356 · 41.2s". */
export function describeProvenance(provenance: Provenance): string {
  const parts = [provenance.source, provenance.engine];
  if (provenance.durationMs >= 100) parts.push(`${(provenance.durationMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}
