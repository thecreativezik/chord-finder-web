import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { EllipsisIcon, PencilIcon, Repeat2Icon, XIcon } from "lucide-react";

import { cn } from "../cn";
import { beatAtTime, formatBarBeat } from "../analysis/beat-map";
import { getHarmonicFunction } from "../analysis/harmonic-function";
import type { BeatMarker, ChordAnalysisMode, ChordSegment, SectionSegment } from "../types";

const PX_PER_SECOND = 22;
const MIN_TIMELINE_WIDTH = 720;
/** Minimum gap between two printed bar numbers before we thin them out. */
const MIN_BAR_LABEL_PX = 34;
const BAR_LABEL_STRIDES = [1, 2, 4, 8, 16, 32, 64, 128] as const;
const MAX_TIMELINE_WIDTH = 16_000;
const MAX_WAVEFORM_POINTS = 1_600;
const SECTION_LABEL_MAX_LENGTH = 24;
/**
 * Sections are addressed by their bounds rather than by an index or a generated
 * id: an index retargets silently when the lane is recomputed, and an id would
 * have to survive a recomputation that legitimately merges regions. The epsilon
 * absorbs float noise from `snapSections` re-deriving the same boundary.
 */
const SECTION_BOUND_EPSILON = 1e-6;
const WAVEFORM_VIEWBOX_WIDTH = 1_000;
const WAVEFORM_VIEWBOX_HEIGHT = 64;

interface SessionTimelineProps {
  waveform: number[];
  segments: ChordSegment[];
  duration: number;
  currentTime: number;
  activeIndex: number;
  loopStart: number | null;
  loopEnd: number | null;
  onSeek: (seconds: number) => void;
  onEditChord?: (index: number) => void;
  keyTonic: string;
  analysisMode: ChordAnalysisMode;
  /** Arrangement lane. Empty when the song was too short to read structure. */
  sections: SectionSegment[];
  activeSectionIndex: number;
  /** Musical coordinates for the bar ruler; empty before analysis. */
  beatMap: BeatMarker[];
  onLoopSection?: (section: SectionSegment) => void;
  onRenameSection?: (index: number, label: string) => void;
  /**
   * Changes when the analysed song or chord source is replaced. Any open
   * section panel is discarded, so a pending action cannot be applied to a
   * region belonging to different audio.
   */
  analysisKey?: string;
  /**
   * Changes when the musician picks a different metre. Needed as its own
   * signal because a metre change renumbers every bar on screen while
   * frequently leaving the section *bounds* untouched — 32s and 64s are
   * downbeats in 4/4 and in 2/4 — so a bounds comparison misses it.
   */
  metreKey?: string;
}

interface SectionBounds {
  startSec: number;
  endSec: number;
}

function sameBounds(section: SectionSegment, bounds: SectionBounds): boolean {
  return (
    Math.abs(section.startSec - bounds.startSec) < SECTION_BOUND_EPSILON &&
    Math.abs(section.endSec - bounds.endSec) < SECTION_BOUND_EPSILON
  );
}

interface TimelineTick {
  time: number;
  major: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatTime(seconds: number, showTenths = false): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const tenths = Math.floor((safeSeconds % 1) * 10);
  const secondsLabel = `${wholeSeconds.toString().padStart(2, "0")}${showTenths ? `.${tenths}` : ""}`;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secondsLabel}`;
  }

  return `${minutes}:${secondsLabel}`;
}

function chooseMajorTickInterval(duration: number, width: number): number {
  const targetSeconds = (duration / Math.max(width, 1)) * 112;
  const intervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1_200];
  return intervals.find((interval) => interval >= targetSeconds) ?? intervals[intervals.length - 1];
}

function createTicks(duration: number, width: number): { ticks: TimelineTick[]; majorInterval: number } {
  const majorInterval = chooseMajorTickInterval(duration, width);
  const minorInterval = majorInterval / 4;
  const count = Math.min(Math.floor(duration / minorInterval), 2_000);
  const ticks = Array.from({ length: count + 1 }, (_, index) => {
    const time = index * minorInterval;
    return {
      time,
      major: index % 4 === 0,
    };
  });

  return { ticks, majorInterval };
}

function reduceWaveform(waveform: number[]): number[] {
  if (waveform.length <= MAX_WAVEFORM_POINTS) {
    return waveform.map((value) => clamp(Math.abs(Number.isFinite(value) ? value : 0), 0, 1));
  }

  const bucketSize = waveform.length / MAX_WAVEFORM_POINTS;
  return Array.from({ length: MAX_WAVEFORM_POINTS }, (_, bucketIndex) => {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucketIndex + 1) * bucketSize));
    let peak = 0;

    for (let index = start; index < Math.min(end, waveform.length); index += 1) {
      const value = waveform[index];
      peak = Math.max(peak, Math.abs(Number.isFinite(value) ? value : 0));
    }

    return clamp(peak, 0, 1);
  });
}

function createWaveformPath(waveform: number[]): string {
  const samples = reduceWaveform(waveform);
  if (samples.length === 0) return "";

  const values = samples.length === 1 ? [samples[0], samples[0]] : samples;
  const middle = WAVEFORM_VIEWBOX_HEIGHT / 2;
  const amplitude = middle - 5;
  const top = values.map((value, index) => {
    const x = (index / (values.length - 1)) * WAVEFORM_VIEWBOX_WIDTH;
    return `${x.toFixed(2)},${(middle - value * amplitude).toFixed(2)}`;
  });
  const bottom = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * WAVEFORM_VIEWBOX_WIDTH;
      return `${x.toFixed(2)},${(middle + value * amplitude).toFixed(2)}`;
    })
    .reverse();

  return `M${top[0]} L${top.slice(1).join(" L")} L${bottom.join(" L")} Z`;
}

export function SessionTimeline({
  waveform,
  segments,
  duration,
  currentTime,
  activeIndex,
  loopStart,
  loopEnd,
  onSeek,
  onEditChord,
  keyTonic,
  analysisMode,
  sections,
  activeSectionIndex,
  beatMap,
  onLoopSection,
  onRenameSection,
  analysisKey,
  metreKey,
}: SessionTimelineProps) {
  const rootOnly = analysisMode === "bass-root";
  const gradientId = `session-waveform-${useId().replace(/:/g, "")}`;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // The section the panel acts on, held as bounds so that playback moving into
  // another region cannot retarget it.
  const [actionTarget, setActionTarget] = useState<SectionBounds | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [invalidationNotice, setInvalidationNotice] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sectionTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `${useId().replace(/:/g, "")}-section-actions`;
  const panelHeadingId = `${panelId}-heading`;
  const renameFieldId = `${panelId}-name`;
  const renameErrorId = `${panelId}-error`;

  const segmentFallbackDuration = useMemo(
    () => segments.reduce((latest, segment) => Math.max(latest, segment.endSec), 0),
    [segments],
  );
  const timelineDuration = Math.max(
    Number.isFinite(duration) && duration > 0 ? duration : segmentFallbackDuration,
    0.001,
  );
  const trackWidth = clamp(timelineDuration * PX_PER_SECOND, MIN_TIMELINE_WIDTH, MAX_TIMELINE_WIDTH);
  const clampedTime = clamp(Number.isFinite(currentTime) ? currentTime : 0, 0, timelineDuration);
  const playheadPercent = (clampedTime / timelineDuration) * 100;

  const waveformPath = useMemo(() => createWaveformPath(waveform), [waveform]);
  const { ticks, majorInterval } = useMemo(
    () => createTicks(timelineDuration, trackWidth),
    [timelineDuration, trackWidth],
  );
  const majorTicks = useMemo(() => ticks.filter((tick) => tick.major), [ticks]);

  // Bar ruler. Only downbeats from bar 1 onwards are drawn; a pickup lands in
  // bar 0 and numbering it would shift the whole chart by a bar.
  const barTicks = useMemo(
    () => beatMap.filter((marker) => marker.beatInBar === 1 && marker.bar >= 1),
    [beatMap],
  );
  const barLabelStride = useMemo(() => {
    if (barTicks.length < 2) return 1;
    const span = barTicks[barTicks.length - 1].timeSec - barTicks[0].timeSec;
    const spacingPx = (span / (barTicks.length - 1) / timelineDuration) * trackWidth;
    if (!Number.isFinite(spacingPx) || spacingPx <= 0) return 1;
    return (
      BAR_LABEL_STRIDES.find((stride) => stride * spacingPx >= MIN_BAR_LABEL_PX) ??
      BAR_LABEL_STRIDES[BAR_LABEL_STRIDES.length - 1]
    );
  }, [barTicks, timelineDuration, trackWidth]);

  const playheadBeat = beatAtTime(beatMap, clampedTime);

  const sectionKey = (section: SectionBounds) => `${section.startSec}-${section.endSec}`;
  const targetIndex = actionTarget
    ? sections.findIndex((section) => sameBounds(section, actionTarget))
    : -1;
  const targetSection = targetIndex >= 0 ? sections[targetIndex] : null;

  const focusTrigger = useCallback((bounds: SectionBounds) => {
    sectionTriggerRefs.current.get(`${bounds.startSec}-${bounds.endSec}`)?.focus();
  }, []);

  /**
   * Move focus into the panel when it opens or switches to the editor. The
   * panel follows the entire scrolling lane in DOM order, so a keyboard user
   * who did not get focus moved here would have to tab through every remaining
   * region to reach Loop and Rename. Keyed on the target's bounds so the
   * playhead ticking cannot steal focus back.
   */
  const panelFocusKey = actionTarget ? `${sectionKey(actionTarget)}:${isRenaming}` : null;
  useEffect(() => {
    if (panelFocusKey === null) return;
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      return;
    }
    panelRef.current?.querySelector("button")?.focus();
  }, [isRenaming, panelFocusKey]);

  /**
   * A metre change or a re-analysis can move, merge or remove the region the
   * panel is acting on. Discard the panel rather than retarget it, and leave
   * focus where the musician put it — they are standing on the metre picker,
   * not on the lane. An uncommitted draft is announced, never applied to
   * whatever region now occupies those bounds.
   */
  useEffect(() => {
    if (!actionTarget) return;
    if (sections.some((section) => sameBounds(section, actionTarget))) return;
    setActionTarget(null);
    setRenameError(null);
    if (isRenaming) {
      setIsRenaming(false);
      setInvalidationNotice("Sections changed. The rename was cancelled.");
    } else {
      setInvalidationNotice("Sections changed. Section actions closed.");
    }
    // Deliberately not focusTrigger(): the region it pointed at is gone.
  }, [actionTarget, isRenaming, sections]);

  /**
   * A metre change invalidates a pending action even when the bounds survive
   * it: the region the musician chose is at bar 17 before the change and bar 33
   * after, so an uncommitted draft is no longer addressed to what they picked.
   * Focus stays on the picker they are standing on.
   */
  const seenMetreKey = useRef(metreKey);
  useEffect(() => {
    if (seenMetreKey.current === metreKey) return;
    seenMetreKey.current = metreKey;
    if (!actionTarget) return;
    setActionTarget(null);
    setRenameError(null);
    if (isRenaming) {
      setIsRenaming(false);
      setInvalidationNotice("Sections changed. The rename was cancelled.");
    } else {
      setInvalidationNotice("Sections changed. Section actions closed.");
    }
  }, [actionTarget, isRenaming, metreKey]);

  // A replacement song or chord source invalidates a pending action outright,
  // even in the unlikely case that a region with identical bounds exists in it.
  useEffect(() => {
    setActionTarget(null);
    setIsRenaming(false);
    setRenameError(null);
    setInvalidationNotice("");
  }, [analysisKey]);

  const openSectionActions = (section: SectionSegment) => {
    setActionTarget({ startSec: section.startSec, endSec: section.endSec });
    setIsRenaming(false);
    setRenameError(null);
    setInvalidationNotice("");
  };

  const closeSectionActions = () => {
    const bounds = actionTarget;
    setActionTarget(null);
    setIsRenaming(false);
    setRenameError(null);
    if (bounds) focusTrigger(bounds);
  };

  const startRename = () => {
    if (!onRenameSection || !targetSection) return;
    setDraftLabel(targetSection.label);
    setRenameError(null);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = draftLabel.trim();
    if (trimmed.length === 0) {
      // Stays open with the error beside the input; a blank name is a mistake,
      // not an instruction to discard the section's name.
      setRenameError("Enter a name for this section.");
      renameInputRef.current?.focus();
      return;
    }
    if (!onRenameSection || targetIndex < 0 || !targetSection) return;
    if (trimmed !== targetSection.label) onRenameSection(targetIndex, trimmed);
    // A label-only rename does not move the bounds, so the panel target stays
    // valid and focus returns to the trigger it was opened from.
    setIsRenaming(false);
    setRenameError(null);
    closeSectionActions();
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameError(null);
    closeSectionActions();
  };

  const hasLoop =
    loopStart !== null &&
    loopEnd !== null &&
    Number.isFinite(loopStart) &&
    Number.isFinite(loopEnd) &&
    loopEnd > loopStart;
  const safeLoopStart = hasLoop ? clamp(loopStart, 0, timelineDuration) : 0;
  const safeLoopEnd = hasLoop ? clamp(loopEnd, safeLoopStart, timelineDuration) : 0;
  const loopLeft = (safeLoopStart / timelineDuration) * 100;
  const loopWidth = ((safeLoopEnd - safeLoopStart) / timelineDuration) * 100;
  // Named only when the loop actually coincides with a region; an A/B loop set
  // by ear stays anonymous rather than borrowing a nearby section's name.
  const loopedSection = hasLoop
    ? sections.find((section) => sameBounds(section, { startSec: safeLoopStart, endSec: safeLoopEnd })) ?? null
    : null;

  const validSelectedIndex =
    selectedIndex !== null && selectedIndex >= 0 && selectedIndex < segments.length
      ? selectedIndex
      : null;
  const validActiveIndex = activeIndex >= 0 && activeIndex < segments.length ? activeIndex : null;
  const editIndex = validSelectedIndex ?? validActiveIndex ?? (segments.length > 0 ? 0 : null);
  const editSegment = editIndex === null ? null : segments[editIndex];

  const seekFromPointer = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    onSeek(ratio * timelineDuration);
  };

  const handleTimelineKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const smallStep = event.shiftKey ? 0.1 : 1;
    let nextTime: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextTime = clampedTime - smallStep;
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextTime = clampedTime + smallStep;
        break;
      case "PageDown":
        nextTime = clampedTime - 10;
        break;
      case "PageUp":
        nextTime = clampedTime + 10;
        break;
      case "Home":
        nextTime = 0;
        break;
      case "End":
        nextTime = timelineDuration;
        break;
      default:
        return;
    }

    event.preventDefault();
    onSeek(clamp(nextTime, 0, timelineDuration));
  };

  return (
    <section
      data-timeline
      aria-label="Song timeline"
      className="overflow-hidden rounded-lg bg-well shadow-[inset_0_0_0_1px_var(--cf-separator)]"
    >
      {/* Under 640px the readout gets its own row: at 360px the single-row
          version clipped `0:00 / 1:36 · bar 1.1` to `0:00 / 1:…`, which hides
          exactly the musical position the bar ruler exists to provide. */}
      <div className="flex min-h-11 flex-col gap-1 border-b border-separator px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-mini-strong shrink-0 text-secondary">
            {rootOnly ? "Detected roots" : "Timeline"}
          </h2>
          <output
            aria-label={`Playhead at ${formatTime(clampedTime)} of ${formatTime(timelineDuration)}`}
            className="font-mono text-mini text-tertiary tabular-nums"
          >
            {formatTime(clampedTime)} / {formatTime(timelineDuration)}
            {playheadBeat ? ` · bar ${formatBarBeat(playheadBeat)}` : ""}
          </output>
        </div>

        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        {loopedSection ? (
          <span className="inline-flex items-center gap-1.5 rounded-md px-2 text-mini font-medium text-accent [&_svg]:size-3.5">
            <Repeat2Icon aria-hidden="true" />
            <span className="max-w-28 truncate">Looping {loopedSection.label}</span>
          </span>
        ) : null}

        {!rootOnly && onEditChord && editSegment && editIndex !== null ? (
          <button
            type="button"
            onClick={() => onEditChord(editIndex)}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-secondary transition-[background-color,color,scale] duration-150 ease-out hover:bg-control hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.96] [&_svg]:size-3.5"
            aria-label={`Edit ${editSegment.symbol} chord`}
            title={`Edit ${editSegment.symbol}`}
          >
            <PencilIcon aria-hidden="true" />
            <span className="max-w-28 truncate">Edit {editSegment.symbol}</span>
          </button>
        ) : null}
        </div>
      </div>

      {sections.length > 0 ? (
        <p className="border-b border-separator px-3 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-tertiary">
          Sections
        </p>
      ) : null}

      <div data-scroll-lane className="w-full overflow-x-auto overscroll-x-contain [scrollbar-color:var(--cf-control)_transparent] [scrollbar-width:thin]">
        <div
          className="relative isolate min-w-full select-none"
          style={{ width: `${trackWidth}px` }}
        >
          <div
            className="relative h-6 cursor-crosshair border-b border-separator bg-control-subtle"
            onPointerDown={seekFromPointer}
            aria-hidden="true"
          >
            {ticks.map((tick) => {
              const percent = (tick.time / timelineDuration) * 100;
              const nearRightEdge = timelineDuration - tick.time < majorInterval * 0.55;

              return (
                <span
                  key={tick.time}
                  className={cn(
                    "absolute bottom-0 w-px bg-tertiary/45",
                    tick.major ? "h-2.5" : "h-1.5 opacity-55",
                  )}
                  style={{ left: `${percent}%` }}
                >
                  {tick.major ? (
                    <span
                      className={cn(
                        "absolute top-[-12px] whitespace-nowrap font-mono text-[9px] leading-none text-tertiary tabular-nums",
                        nearRightEdge ? "right-1" : "left-1",
                      )}
                    >
                      {formatTime(tick.time, majorInterval < 1)}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>

          {barTicks.length >= 2 ? (
            <div
              data-bar-ruler
              className="relative h-4 cursor-crosshair border-b border-separator bg-well"
              onPointerDown={seekFromPointer}
              aria-hidden="true"
            >
              {barTicks.map((marker) => {
                const labelled = (marker.bar - 1) % barLabelStride === 0;
                return (
                  <span
                    key={`bar-${marker.bar}`}
                    className={cn(
                      "absolute bottom-0 w-px",
                      labelled ? "h-full bg-tertiary/50" : "h-1.5 bg-tertiary/30",
                    )}
                    style={{ left: `${(marker.timeSec / timelineDuration) * 100}%` }}
                  >
                    {labelled ? (
                      <span className="absolute left-1 top-0 whitespace-nowrap font-mono text-[9px] leading-4 text-tertiary tabular-nums">
                        {marker.bar}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : null}

          {sections.length > 0 ? (
            <div
              role="list"
              aria-label="Arrangement sections"
              data-section-band
              className="relative h-9 border-b border-separator bg-well"
            >
              {sections.map((section, index) => {
                const start = clamp(
                  Number.isFinite(section.startSec) ? section.startSec : 0,
                  0,
                  timelineDuration,
                );
                const end = clamp(
                  Number.isFinite(section.endSec) ? section.endSec : start,
                  start,
                  timelineDuration,
                );
                if (end <= start) return null;

                const active = index === activeSectionIndex;
                const chosen = actionTarget !== null && sameBounds(section, actionTarget);
                const key = sectionKey(section);
                const startBeat = beatAtTime(beatMap, start);
                const barRange = startBeat ? `, from bar ${startBeat.bar}` : "";
                const widthPercent = ((end - start) / timelineDuration) * 100;

                return (
                  <div
                    key={`section-${key}-${index}`}
                    role="listitem"
                    className="absolute inset-y-0 flex items-stretch px-px"
                    style={{ left: `${(start / timelineDuration) * 100}%`, width: `${widthPercent}%` }}
                  >
                    {/* Fills the whole region so a click anywhere in it seeks,
                        and sits beneath the pinned label group. */}
                    <button
                      type="button"
                      onClick={() => onSeek(start)}
                      aria-current={active ? "true" : undefined}
                      aria-label={`Section ${section.label}${barRange}, ${formatTime(start)} to ${formatTime(end)}${section.edited ? ", renamed" : ""}. Seeks to its start`}
                      className={cn(
                        "absolute inset-0 rounded-[3px] transition-[background-color] duration-150 ease-out focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                        active ? "bg-accent/15" : "bg-control-subtle hover:bg-control",
                      )}
                    />

                    {/* The label and its actions trigger travel together,
                        pinned to the lane edge but constrained to their own
                        region. Previously the trigger sat at the region's right
                        edge: a 32-second section at scrollLeft 0 put it ~340px
                        beyond a 360px viewport, hiding both Loop and Rename
                        until you discovered a horizontal scroll. */}
                    <div
                      data-section-pinned
                      className="pointer-events-none sticky left-0 z-10 flex min-w-0 max-w-full items-center"
                    >
                      <span
                        className={cn(
                          "truncate px-2 text-small-strong leading-4",
                          active ? "text-accent" : "text-secondary",
                        )}
                      >
                        {section.label}
                      </span>

                      {onLoopSection || onRenameSection ? (
                        <button
                          data-section-actions
                          type="button"
                          ref={(node) => {
                            if (node) sectionTriggerRefs.current.set(key, node);
                            else sectionTriggerRefs.current.delete(key);
                          }}
                          onClick={() => openSectionActions(section)}
                          aria-label={`Section ${section.label} actions`}
                          aria-expanded={chosen}
                          aria-controls={chosen ? panelId : undefined}
                          title={`Section ${section.label} actions`}
                          className={cn(
                            "pointer-events-auto flex w-6 shrink-0 self-stretch items-center justify-center rounded-[3px] transition-[background-color,color] duration-150 ease-out focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent [&_svg]:size-3.5",
                            chosen
                              ? "bg-accent/25 text-accent"
                              : "bg-control text-tertiary hover:text-primary",
                          )}
                        >
                          <EllipsisIcon aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div
            role="slider"
            tabIndex={0}
            aria-label="Waveform seek control"
            aria-valuemin={0}
            aria-valuemax={timelineDuration}
            aria-valuenow={clampedTime}
            aria-valuetext={formatTime(clampedTime)}
            aria-orientation="horizontal"
            onPointerDown={seekFromPointer}
            onKeyDown={handleTimelineKeyDown}
            className="relative h-16 cursor-crosshair overflow-hidden border-b border-separator bg-well focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            {majorTicks.map((tick) => (
              <span
                key={tick.time}
                aria-hidden="true"
                className="absolute inset-y-0 w-px bg-separator/70"
                style={{ left: `${(tick.time / timelineDuration) * 100}%` }}
              />
            ))}

            {waveformPath ? (
              <svg
                aria-hidden="true"
                className="absolute inset-0 size-full"
                viewBox={`0 0 ${WAVEFORM_VIEWBOX_WIDTH} ${WAVEFORM_VIEWBOX_HEIGHT}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
                    <stop offset={`${playheadPercent}%`} stopColor="var(--cf-accent)" stopOpacity="0.72" />
                    <stop offset={`${playheadPercent}%`} stopColor="var(--cf-text-quaternary)" stopOpacity="0.58" />
                  </linearGradient>
                </defs>
                <path d={waveformPath} fill={`url(#${gradientId})`} />
              </svg>
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-mini text-tertiary">
                Waveform unavailable
              </span>
            )}

            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 h-px bg-separator/80"
            />
          </div>

          <div
            role="list"
            aria-label={rootOnly ? "Detected roots" : "Detected chords"}
            className="relative h-14 overflow-hidden bg-well"
          >
            {segments.map((segment, index) => {
              const harmonicFunction = getHarmonicFunction(segment.symbol, keyTonic);
              const start = clamp(Number.isFinite(segment.startSec) ? segment.startSec : 0, 0, timelineDuration);
              const end = clamp(Number.isFinite(segment.endSec) ? segment.endSec : start, start, timelineDuration);
              if (end <= start) return null;

              const active = index === activeIndex;
              const lowConfidence =
                !segment.edited && Number.isFinite(segment.confidence) && segment.confidence < 0.62;
              const widthPercent = ((end - start) / timelineDuration) * 100;
              const estimatedWidth = (widthPercent / 100) * trackWidth;
              const compact = estimatedWidth < 68;

              return (
                <div
                  key={`${segment.startSec}-${segment.endSec}-${index}`}
                  role="listitem"
                  className="absolute inset-y-0 border-r border-well"
                  style={{
                    left: `${(start / timelineDuration) * 100}%`,
                    width: `${widthPercent}%`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIndex(index);
                      onSeek(start);
                    }}
                    onDoubleClick={() => {
                      if (!rootOnly && onEditChord) onEditChord(index);
                    }}
                    onFocus={() => setSelectedIndex(index)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`${rootOnly ? "Detected root" : "Chord"} ${segment.symbol}, ${harmonicFunction.spokenLabel}, ${formatTime(start)} to ${formatTime(end)}${segment.edited ? ", manually corrected" : ""}${!rootOnly && onEditChord ? ". Double-click or use the edit chord button to edit" : ""}`}
                    title={`${rootOnly ? "Root" : "Chord"} ${segment.symbol}  ${formatTime(start)} - ${formatTime(end)}${!rootOnly && onEditChord ? "  Double-click to edit" : ""}`}
                    className={cn(
                      "relative flex size-full min-w-0 flex-col items-start justify-center overflow-hidden rounded-[3px] px-2 text-left transition-[background-color,color] duration-150 ease-out focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                      active
                        ? "bg-accent/15 text-accent"
                        : "bg-control-subtle text-primary hover:bg-control",
                    )}
                  >
                    <span
                      className={cn(
                        "block max-w-full truncate text-small-strong leading-4",
                        lowConfidence && !active && "text-secondary",
                      )}
                    >
                      {segment.symbol}
                    </span>
                    <span className={cn("block max-w-full truncate text-[9px] font-semibold leading-3", active ? "text-accent/80" : "text-tertiary")}>
                      {harmonicFunction.shortLabel}
                      {!compact && segment.edited ? " · Edited" : ""}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {hasLoop && loopWidth > 0 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-x border-accent/70 bg-accent/[0.06]"
              style={{ left: `${loopLeft}%`, width: `${loopWidth}%` }}
            />
          ) : null}

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent shadow-[0_0_0_1px_color-mix(in_srgb,var(--cf-accent)_20%,transparent)]"
            style={{ left: `${playheadPercent}%` }}
          >
            <span className="absolute -left-1 top-0 size-2 rounded-[2px] bg-accent" />
          </div>
        </div>
      </div>

      {hasLoop ? (
        <span className="sr-only">
          Loop from {formatTime(safeLoopStart)} to {formatTime(safeLoopEnd)}
        </span>
      ) : null}

      {/* The panel sits below the lane rather than inside the region it acts
          on: a region can be a few pixels wide, and the lane scrolls
          horizontally, so anything anchored inside it is either unreadable or
          scrolled off. It names its target instead. */}
      {targetSection ? (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-labelledby={panelHeadingId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            if (isRenaming) cancelRename();
            else closeSectionActions();
          }}
          className="border-t border-separator px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={panelHeadingId} className="text-small-strong text-primary">
              Section {targetSection.label}
            </h3>
            <p className="text-mini text-tertiary">
              {targetSection.edited ? "Renamed by you" : "Detected structure"}
              {" · "}
              {formatTime(targetSection.startSec)}–{formatTime(targetSection.endSec)}
            </p>
          </div>

          {isRenaming ? (
            <div className="mt-2 flex flex-col gap-1.5 sm:max-w-sm">
              <label htmlFor={renameFieldId} className="text-mini text-secondary">
                Section name
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  ref={renameInputRef}
                  id={renameFieldId}
                  value={draftLabel}
                  onChange={(event) => {
                    setDraftLabel(event.target.value);
                    if (renameError) setRenameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename();
                    }
                  }}
                  maxLength={SECTION_LABEL_MAX_LENGTH}
                  aria-invalid={renameError ? "true" : undefined}
                  aria-describedby={renameError ? renameErrorId : undefined}
                  className="h-10 min-w-0 flex-1 rounded-md border border-separator bg-background px-2.5 text-small text-primary outline-none focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                />
                <button type="button" onClick={commitRename} className="tool-button shrink-0">
                  Save
                </button>
                <button type="button" onClick={cancelRename} className="tool-button shrink-0">
                  Cancel
                </button>
              </div>
              {renameError ? (
                <p id={renameErrorId} className="text-mini text-amber-400">
                  {renameError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {onLoopSection ? (
                <button
                  type="button"
                  onClick={() => onLoopSection(targetSection)}
                  className="tool-button"
                  aria-label={`Loop section ${targetSection.label}`}
                >
                  <Repeat2Icon aria-hidden="true" /> Loop section
                </button>
              ) : null}
              {onRenameSection ? (
                <button
                  type="button"
                  onClick={startRename}
                  className="tool-button"
                  aria-label={`Rename section ${targetSection.label}`}
                >
                  <PencilIcon aria-hidden="true" /> Rename section
                </button>
              ) : null}
              <button
                type="button"
                onClick={closeSectionActions}
                className="tool-button"
                aria-label={`Close section ${targetSection.label} actions`}
              >
                <XIcon aria-hidden="true" /> Close
              </button>
            </div>
          )}
        </div>
      ) : null}

      <span role="status" aria-live="polite" className="sr-only">
        {invalidationNotice}
      </span>
    </section>
  );
}
