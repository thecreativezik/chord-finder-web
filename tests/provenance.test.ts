import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHORD_ENGINE,
  chordDecoderParams,
  createProvenance,
  describeProvenance,
  isRootOnly,
  ORIGINAL_MIX_SOURCE,
  stemSeparationEngine,
} from "../src/analysis/provenance";
import type { Provenance, StemKindLike } from "./provenance-fixtures";
import { bassRootChords, harmonyChords } from "./provenance-fixtures";

describe("engine identity", () => {
  it("names the essentia version actually installed", () => {
    // The whole point of `engine` is that a bump is visible in the artifact.
    // If this fails, bump CHORD_ENGINE in the same commit as the dependency:
    // every artifact produced in between would claim the wrong decoder.
    const installed = JSON.parse(
      readFileSync(new URL("../node_modules/essentia.js/package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(CHORD_ENGINE).toContain(`@${installed.version}`);
  });

  it("truncates a model revision to a readable prefix", () => {
    expect(stemSeparationEngine("939723568b2dca203e61cc7294317ba38549964f")).toBe(
      "htdemucs_6s@93972356",
    );
  });

  it("does not pad a revision it cannot truncate", () => {
    expect(stemSeparationEngine("abc")).toBe("htdemucs_6s@abc");
  });
});

describe("createProvenance", () => {
  it("measures elapsed time from the caller's start", () => {
    const provenance = createProvenance({
      module: "chords",
      source: "Bass",
      engine: CHORD_ENGINE,
      startedAt: 1_000,
      finishedAt: 3_400,
    });
    expect(provenance.durationMs).toBe(2_400);
    expect(provenance.startedAt).toBe(1_000);
  });

  it("never reports a negative duration when the clock steps backwards", () => {
    // Date.now() is not monotonic; an NTP correction mid-analysis would
    // otherwise produce a negative duration in a user-visible tooltip.
    const provenance = createProvenance({
      module: "chords",
      source: "Bass",
      engine: CHORD_ENGINE,
      startedAt: 5_000,
      finishedAt: 4_000,
    });
    expect(provenance.durationMs).toBe(0);
  });

  it("omits params entirely rather than storing an empty object", () => {
    const provenance = createProvenance({
      module: "stem-separation",
      source: ORIGINAL_MIX_SOURCE,
      engine: stemSeparationEngine("939723568b2dca203e61cc7294317ba38549964f"),
      startedAt: 0,
      finishedAt: 10,
    });
    expect("params" in provenance).toBe(false);
  });
});

describe("chordDecoderParams", () => {
  it("records the decoder and rounds the tuning reference", () => {
    expect(chordDecoderParams("bass-root", 441.8321)).toEqual({
      decoder: "bass-root",
      tuningHz: 441.8,
    });
  });
});

describe("isRootOnly", () => {
  it("is true only for the bass-root decoder", () => {
    expect(isRootOnly(bassRootChords("Bass").provenance)).toBe(true);
    expect(isRootOnly(harmonyChords(ORIGINAL_MIX_SOURCE).provenance)).toBe(false);
  });

  it("is false for an artifact with no decoder recorded", () => {
    const provenance: Provenance = {
      module: "stem-separation",
      source: ORIGINAL_MIX_SOURCE,
      engine: "htdemucs_6s@93972356",
      startedAt: 0,
      durationMs: 0,
    };
    expect(isRootOnly(provenance)).toBe(false);
  });

  it("is false when there is nothing to read", () => {
    expect(isRootOnly(null)).toBe(false);
    expect(isRootOnly(undefined)).toBe(false);
  });
});

/**
 * The regression this change exists for.
 *
 * `App` used to decide whether the displayed chords were root-only by looking
 * up the *currently selected track* and testing `track.kind === "bass"`. The
 * source-reset guard runs in an effect, so for one render after a stem is
 * removed the lookup misses while the stem's segments are still on screen —
 * root output presented as editable chords.
 *
 * This exercises the extracted decision, not an `App` render: `App` needs an
 * AudioContext and cannot be rendered under vitest. What it proves is that the
 * decision no longer takes the track list as an input, which is what made the
 * divergence possible.
 */
describe("root-only detection survives the source track's removal", () => {
  const derived = bassRootChords("Bass");
  const present: StemKindLike[] = [
    { id: "original-mix", kind: "original" },
    { id: "stem-1", kind: "bass" },
  ];
  const afterRemoval: StemKindLike[] = [{ id: "original-mix", kind: "original" }];

  /** How App decided before this change: a live lookup by the selected id. */
  function fromTracks(tracks: readonly StemKindLike[], trackId: string): boolean {
    return tracks.find((track) => track.id === trackId)?.kind === "bass";
  }

  it("agreed with the artifact while the stem was in the mixer", () => {
    expect(fromTracks(present, "stem-1")).toBe(isRootOnly(derived.provenance));
  });

  it("disagreed for the render after the stem was removed", () => {
    // The source-reset guard is an effect, so `chordSourceId` still points at
    // the removed stem for one render while its segments are on screen. The
    // old derivation said "harmony", which switched chord editing on.
    expect(fromTracks(afterRemoval, "stem-1")).toBe(false);
    expect(isRootOnly(derived.provenance)).toBe(true);
  });

  it("keeps the recorded source name once the live track is gone", () => {
    expect(derived.provenance.source).toBe("Bass");
  });
});

describe("describeProvenance", () => {
  it("reads as one line of attribution", () => {
    expect(describeProvenance(bassRootChords("Bass", 41_200).provenance)).toBe(
      `Bass · ${CHORD_ENGINE} · 41.2s`,
    );
  });

  it("degrades instead of throwing when the record is absent or malformed", () => {
    // Called during render: throwing here takes down the session view, which
    // is a disproportionate outcome for absent metadata. Vector reached this
    // with a review fixture that predated the schema — the app failed to load
    // rather than rendering without a tooltip.
    const missing = undefined as unknown as Provenance;
    expect(describeProvenance(missing)).toBeUndefined();
    expect(describeProvenance(null as unknown as Provenance)).toBeUndefined();
    expect(describeProvenance({} as Provenance)).toBeUndefined();
    expect(
      describeProvenance({
        module: "chords",
        source: "Bass",
        engine: CHORD_ENGINE,
        startedAt: 0,
        durationMs: Number.NaN,
      }),
    ).toBe(`Bass · ${CHORD_ENGINE}`);
  });

  it("omits a duration too short to be worth reading", () => {
    expect(describeProvenance(bassRootChords("Bass", 40).provenance)).toBe(
      `Bass · ${CHORD_ENGINE}`,
    );
  });
});
