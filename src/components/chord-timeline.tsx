// Horizontal, clickable chord progression. Each segment seeks playback to its
// start; the active segment is emphasized.

import { cn } from "../cn";

import { NO_CHORD } from "../analysis/classify-chords";
import type { ChordSegment } from "../types";
import { formatTime } from "./use-playback";

const PX_PER_SECOND = 26;
const MIN_SEGMENT_PX = 46;

interface ChordTimelineProps {
  segments: ChordSegment[];
  activeIndex: number;
  onSeek: (seconds: number) => void;
}

export function ChordTimeline({ segments, activeIndex, onSeek }: ChordTimelineProps) {
  return (
    <div className="w-full shrink-0 overflow-x-auto">
      <div className="flex items-stretch gap-1 px-4 py-3">
        {segments.map((segment, index) => {
          const active = index === activeIndex;
          const isNoChord = segment.symbol === NO_CHORD;
          const lowConfidence = !isNoChord && segment.confidence < 0.62;
          return (
            <button
              key={`${segment.startSec}-${index}`}
              type="button"
              onClick={() => onSeek(segment.startSec)}
              style={{
                minWidth: Math.max(MIN_SEGMENT_PX, (segment.endSec - segment.startSec) * PX_PER_SECOND),
              }}
              className={cn(
                "flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-transparent px-3 py-2 transition-colors",
                active ? "border-accent bg-accent/10" : "bg-control-subtle hover:bg-control",
                lowConfidence && !active && "opacity-65",
              )}
            >
              <span
                className={cn(
                  "text-small-strong tabular-nums",
                  active ? "text-accent" : isNoChord ? "text-tertiary" : "text-primary",
                )}
              >
                {segment.symbol}
              </span>
              <span className={cn("text-mini tabular-nums", active ? "text-accent" : "text-tertiary")}>
                {formatTime(segment.startSec)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
