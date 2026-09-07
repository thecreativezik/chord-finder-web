import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_TIME_SIGNATURE, buildBeatMap } from "../src/analysis/beat-map";
import { SessionTimeline } from "../src/components/session-timeline";
import type { ChordSegment, SectionSegment } from "../src/types";

// The arrangement lane is new markup with new geometry behind it. Without a
// browser in this project's toolchain, server rendering is what is available to
// prove the lane renders at all and that no percentage it computes comes out
// NaN — the failure that silently collapses an absolutely-positioned track.

const beatMap = buildBeatMap(
  Array.from({ length: 64 }, (_, index) => index * 0.5),
  DEFAULT_TIME_SIGNATURE,
  0,
);

const segments: ChordSegment[] = [
  { symbol: "C", startSec: 0, endSec: 8, confidence: 0.95 },
  { symbol: "Am", startSec: 8, endSec: 16, confidence: 0.9 },
  { symbol: "F", startSec: 16, endSec: 24, confidence: 0.55 },
  { symbol: "G", startSec: 24, endSec: 32, confidence: 0.91, edited: true },
];

const sections: SectionSegment[] = [
  { label: "A", startSec: 0, endSec: 16, confidence: 0.82 },
  { label: "Chorus", startSec: 16, endSec: 32, confidence: 0.94, edited: true },
];

function render(overrides: Partial<Parameters<typeof SessionTimeline>[0]> = {}) {
  return renderToStaticMarkup(
    <SessionTimeline
      waveform={Array.from({ length: 128 }, (_, index) => Math.abs(Math.sin(index / 8)))}
      segments={segments}
      duration={32}
      currentTime={18.25}
      activeIndex={2}
      loopStart={16}
      loopEnd={32}
      onSeek={() => {}}
      onEditChord={() => {}}
      keyTonic="C"
      analysisMode="harmony"
      sections={sections}
      activeSectionIndex={1}
      beatMap={beatMap}
      onLoopSection={() => {}}
      onRenameSection={() => {}}
      {...overrides}
    />,
  );
}

describe("SessionTimeline arrangement lane", () => {
  it("renders the lane, its labels and the bar ruler", () => {
    const html = render();
    expect(html).toContain('aria-label="Arrangement sections"');
    expect(html).toContain("Section A, from bar 1, 0:00 to 0:16. Seeks to its start");
    expect(html).toContain("Section Chorus, from bar 9, 0:16 to 0:32, renamed. Seeks to its start");
  });

  it("places arrangement above the waveform, below the rulers", () => {
    // Arrangement describes the larger structure, so it reads as a header band
    // over the audio rather than as a peer of the chord lane beneath it.
    const html = render();
    const barRuler = html.indexOf("data-bar-ruler");
    const band = html.indexOf('aria-label="Arrangement sections"');
    const waveform = html.indexOf('aria-label="Waveform seek control"');
    const chords = html.indexOf('aria-label="Detected chords"');
    expect(barRuler).toBeGreaterThan(-1);
    expect(barRuler).toBeLessThan(band);
    expect(band).toBeLessThan(waveform);
    expect(waveform).toBeLessThan(chords);
  });

  it("labels the band outside the scrolling coordinate canvas", () => {
    const html = render();
    const label = html.indexOf(">Sections<");
    const scrollLane = html.indexOf("data-scroll-lane");
    expect(label).toBeGreaterThan(-1);
    expect(label).toBeLessThan(scrollLane);
  });

  it("reports no confidence percentage in the lane", () => {
    // The stored value is normalized boundary novelty, not a probability that
    // the section or its name is correct, and the first region scores off its
    // closing boundary. It stays in the data and off the screen.
    expect(render()).not.toMatch(/>\s*\d+(\.\d+)?%\s*</);
  });

  it("offers per-region actions rather than a hidden double-click", () => {
    const html = render();
    expect(html).toContain('aria-label="Section A actions"');
    expect(html).toContain('aria-label="Section Chorus actions"');
    expect(html).not.toContain("Double-click to rename");
  });

  it("names the looping section when the loop coincides with one", () => {
    expect(render()).toContain("Looping Chorus");
  });

  it("shows the playhead's bar and beat next to the clock", () => {
    // The beat in effect at 18.25s is beat 36 (18.0s) — bar 10, beat 1. The
    // readout reports the beat the playhead is inside, not the nearest one.
    expect(render()).toContain("bar 10.1");
  });

  it("never emits a NaN offset, which would collapse the track", () => {
    const html = render({ duration: 0, currentTime: Number.NaN });
    expect(html).not.toContain("NaN");
  });

  it("omits the lane, its label and its actions when nothing was detected", () => {
    const html = render({ sections: [], activeSectionIndex: -1 });
    expect(html).not.toContain('aria-label="Arrangement sections"');
    expect(html).not.toContain(">Sections<");
    expect(html).not.toContain("actions");
    // The chord lane and the bar ruler are unaffected.
    expect(html).toContain('aria-label="Detected chords"');
    expect(html).toContain("bar 10.1");
  });

  it("omits the bar ruler when beat tracking produced nothing", () => {
    const html = render({ beatMap: [] });
    expect(html).not.toContain("bar ");
    expect(html).toContain('aria-label="Arrangement sections"');
  });

  it("still renders the lane for a root-only bass source", () => {
    const html = render({ analysisMode: "bass-root", onEditChord: undefined });
    expect(html).toContain('aria-label="Arrangement sections"');
    expect(html).toContain('aria-label="Section Chorus actions"');
    expect(html).toContain("Detected roots");
  });
});
