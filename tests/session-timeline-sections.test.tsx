// @vitest-environment jsdom
//
// The arrangement lane's defects were all interaction defects — a rename that
// seeked the transport, a save that dropped focus to <body> — and server-side
// rendering cannot see any of them. This file drives the real component in a
// DOM so that class of bug fails a test instead of a design review.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TIME_SIGNATURE, buildBeatMap } from "../src/analysis/beat-map";
import { SessionTimeline } from "../src/components/session-timeline";
import type { ChordSegment, SectionSegment } from "../src/types";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const beatMap = buildBeatMap(
  Array.from({ length: 193 }, (_, index) => index * 0.5),
  DEFAULT_TIME_SIGNATURE,
  0,
);

const segments: ChordSegment[] = [
  { symbol: "C", startSec: 0, endSec: 32, confidence: 0.95 },
  { symbol: "Am", startSec: 32, endSec: 64, confidence: 0.9 },
  { symbol: "C", startSec: 64, endSec: 96, confidence: 0.92 },
];

const sections: SectionSegment[] = [
  { label: "A", startSec: 0, endSec: 32, confidence: 0.82 },
  { label: "B", startSec: 32, endSec: 64, confidence: 0.9 },
  { label: "A2", startSec: 64, endSec: 96, confidence: 0.88 },
];

interface Harness {
  root: Root;
  container: HTMLDivElement;
  onSeek: ReturnType<typeof vi.fn>;
  onLoopSection: ReturnType<typeof vi.fn>;
  onRenameSection: ReturnType<typeof vi.fn>;
  render: (overrides?: Partial<Parameters<typeof SessionTimeline>[0]>) => void;
}

let harness: Harness;

function query(selector: string): HTMLElement {
  const node = harness.container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`No element matched ${selector}`);
  return node;
}

function byLabel(label: string): HTMLElement {
  return query(`[aria-label="${label}"]`);
}

function click(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function press(element: HTMLElement, key: string): void {
  act(() => {
    element.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/**
 * React installs its own setter on the input's value property to detect
 * programmatic writes. Assigning `input.value` directly is silently ignored by
 * the change tracker, so go through the prototype's native setter — this is
 * what a real keystroke does.
 */
const nativeInputValue = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)?.set;

function type(input: HTMLInputElement, value: string): void {
  if (!nativeInputValue) throw new Error("No native value setter on HTMLInputElement");
  act(() => {
    nativeInputValue.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSeek = vi.fn();
  const onLoopSection = vi.fn();
  const onRenameSection = vi.fn();

  const render = (overrides: Partial<Parameters<typeof SessionTimeline>[0]> = {}) => {
    act(() => {
      root.render(
        <SessionTimeline
          waveform={Array.from({ length: 128 }, (_, index) => Math.abs(Math.sin(index / 8)))}
          segments={segments}
          duration={96}
          currentTime={4}
          activeIndex={0}
          loopStart={null}
          loopEnd={null}
          onSeek={onSeek}
          onEditChord={() => {}}
          keyTonic="C"
          analysisMode="harmony"
          sections={sections}
          activeSectionIndex={0}
          beatMap={beatMap}
          onLoopSection={onLoopSection}
          onRenameSection={onRenameSection}
          analysisKey="song-1"
          {...overrides}
        />,
      );
    });
  };

  harness = { root, container, onSeek, onLoopSection, onRenameSection, render };
  render();
});

afterEach(() => {
  act(() => harness.root.unmount());
  harness.container.remove();
});

describe("opening section actions", () => {
  it("does not move the transport", () => {
    click(byLabel("Section B actions"));
    expect(harness.onSeek).not.toHaveBeenCalled();
    expect(query('[role="group"]').textContent).toContain("Section B");
  });

  it("leaves the region itself as a plain seek target", () => {
    click(byLabel("Section B, from bar 17, 0:32 to 1:04. Seeks to its start"));
    expect(harness.onSeek).toHaveBeenCalledWith(32);
    expect(harness.container.querySelector('[role="group"]')).toBeNull();
  });

  it("labels a detected section as detected and a renamed one as renamed", () => {
    click(byLabel("Section B actions"));
    expect(query('[role="group"]').textContent).toContain("Detected structure");

    harness.render({
      sections: [sections[0], { ...sections[1], label: "Chorus", edited: true }, sections[2]],
    });
    expect(query('[role="group"]').textContent).toContain("Renamed by you");
  });

  it("reports no confidence percentage anywhere in the lane", () => {
    // Normalized boundary novelty is not a probability that the section is
    // right, and the first region scores off its closing boundary.
    expect(harness.container.textContent).not.toMatch(/\d+%/);
  });
});

describe("keyboard reach", () => {
  it("moves focus into the panel, which follows the whole lane in DOM order", () => {
    click(byLabel("Section B actions"));
    expect(document.activeElement).toBe(byLabel("Loop section B"));
  });

  it("closes on Escape from the panel and restores focus to the trigger", () => {
    click(byLabel("Section B actions"));
    press(byLabel("Loop section B"), "Escape");
    expect(harness.container.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(byLabel("Section B actions"));
  });

  it("focuses the name field when the editor opens", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    expect(document.activeElement).toBe(query("input"));
  });
});

describe("Vector's acceptance case: actions target the chosen region", () => {
  it("loops B even after playback has moved into A2", () => {
    click(byLabel("Section B actions"));
    // Playback runs on into the third section; activeSectionIndex follows it.
    harness.render({ currentTime: 70, activeIndex: 2, activeSectionIndex: 2 });
    click(byLabel("Loop section B"));
    expect(harness.onLoopSection).toHaveBeenCalledTimes(1);
    expect(harness.onLoopSection.mock.calls[0][0]).toMatchObject({ startSec: 32, endSec: 64 });
  });
});

describe("renaming a section", () => {
  it("does not seek, and focuses a labelled field", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    expect(harness.onSeek).not.toHaveBeenCalled();

    const input = query("input") as HTMLInputElement;
    expect(input.value).toBe("B");
    expect(input.maxLength).toBe(24);
    expect(query(`label[for="${input.id}"]`).textContent).toBe("Section name");
  });

  it("saves on Enter and returns focus to the trigger, not the body", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    const input = query("input") as HTMLInputElement;
    type(input, "Chorus");
    press(input, "Enter");

    expect(harness.onRenameSection).toHaveBeenCalledWith(1, "Chorus");
    expect(document.activeElement).toBe(byLabel("Section B actions"));
  });

  it("keeps a blank name open with an error instead of discarding the label", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    const input = query("input") as HTMLInputElement;
    type(input, "   ");
    press(input, "Enter");

    expect(harness.onRenameSection).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(query(`#${input.getAttribute("aria-describedby")}`).textContent)
      .toBe("Enter a name for this section.");
    expect(document.activeElement).toBe(input);
  });

  it("does not save on blur", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    const input = query("input") as HTMLInputElement;
    type(input, "Chorus");
    act(() => {
      input.dispatchEvent(new window.FocusEvent("blur", { bubbles: true }));
    });
    expect(harness.onRenameSection).not.toHaveBeenCalled();
  });

  it("cancels on Escape and restores focus", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    press(query("input"), "Escape");

    expect(harness.onRenameSection).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byLabel("Section B actions"));
  });
});

describe("invalidation", () => {
  it("closes the panel when a metre change reshapes the lane, without touching focus", () => {
    click(byLabel("Section B actions"));
    click(byLabel("Rename section B"));
    type(query("input") as HTMLInputElement, "Chorus");

    // Stand somewhere else, as a musician using the metre picker would be.
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();

    // Re-snapping to a new bar grid merged B into A.
    harness.render({
      sections: [
        { label: "A", startSec: 0, endSec: 64, confidence: 0.82 },
        { label: "A2", startSec: 64, endSec: 96, confidence: 0.88 },
      ],
      activeSectionIndex: 0,
    });

    expect(harness.container.querySelector('[role="group"]')).toBeNull();
    expect(harness.onRenameSection).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
    expect(query('[role="status"]').textContent)
      .toBe("Sections changed. The rename was cancelled.");
    elsewhere.remove();
  });

  it("keeps the panel open for a label-only rename", () => {
    click(byLabel("Section B actions"));
    harness.render({
      sections: [sections[0], { ...sections[1], label: "Chorus", edited: true }, sections[2]],
    });
    expect(harness.container.querySelector('[role="group"]')).not.toBeNull();
    expect(query('[role="group"]').textContent).toContain("Section Chorus");
  });

  it("discards a pending action when the song or chord source is replaced", () => {
    click(byLabel("Section B actions"));
    harness.render({ analysisKey: "song-2" });
    expect(harness.container.querySelector('[role="group"]')).toBeNull();
  });
});

describe("loop indicator", () => {
  it("names the section when the loop coincides with one", () => {
    harness.render({ loopStart: 32, loopEnd: 64 });
    expect(harness.container.textContent).toContain("Looping B");
  });

  it("stays anonymous for a loop set by ear", () => {
    harness.render({ loopStart: 30, loopEnd: 61 });
    expect(harness.container.textContent).not.toContain("Looping");
  });
});
