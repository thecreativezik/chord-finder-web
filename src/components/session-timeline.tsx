import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PencilIcon } from "lucide-react";

import { cn } from "../cn";
import { getHarmonicFunction } from "../analysis/harmonic-function";
import type { ChordAnalysisMode, ChordSegment } from "../types";

const PX_PER_SECOND = 22;
const MIN_TIMELINE_WIDTH = 720;
const MAX_TIMELINE_WIDTH = 16_000;
const MAX_WAVEFORM_POINTS = 1_600;
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
}: SessionTimelineProps) {
  const rootOnly = analysisMode === "bass-root";
  const gradientId = `session-waveform-${useId().replace(/:/g, "")}`;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

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
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-separator px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-mini-strong shrink-0 text-secondary">
            {rootOnly ? "Detected roots" : "Timeline"}
          </h2>
          <output
            aria-label={`Playhead at ${formatTime(clampedTime)} of ${formatTime(timelineDuration)}`}
            className="truncate font-mono text-mini text-tertiary tabular-nums"
          >
            {formatTime(clampedTime)} / {formatTime(timelineDuration)}
          </output>
        </div>

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
    </section>
  );
}
