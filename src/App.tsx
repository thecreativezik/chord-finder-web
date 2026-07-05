// Main screen: import a song, analyze it, and explore its chords on a
// chart-style keyboard diagram. Web port of the macOS app's analyze-view.

import { useMemo, useState } from "react";
import { MusicIcon } from "lucide-react";

import { getChordNotes } from "./analysis/chord-notes";
import { NO_CHORD } from "./analysis/classify-chords";
import { useAnalysis } from "./analysis/use-analysis";
import { ChordTimeline } from "./components/chord-timeline";
import { DropOverlay, DropZoneEmpty, useFileImport } from "./components/drop-zone";
import { TransportBar } from "./components/transport-bar";
import { formatTime, usePlayback } from "./components/use-playback";
import { Piano2D } from "./keyboard/piano-2d";
import type { AnalysisStage, ChordSegment } from "./types";

const STAGE_LABEL: Record<AnalysisStage, string> = {
  decoding: "Decoding audio…",
  extracting: "Detecting key & tempo…",
  chords: "Finding chords…",
  done: "Finishing up…",
};

function findActiveIndex(segments: ChordSegment[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].startSec <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-mini uppercase tracking-wide text-tertiary">{label}</span>
      <span
        className={`text-lg font-semibold tabular-nums ${accent ? "text-accent" : "text-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function App() {
  const { status, analyzeFile, reset } = useAnalysis();
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const { isDragging, dragProps, openPicker } = useFileImport({ onFile: analyzeFile });

  const playback = usePlayback(audioEl);

  const result = status.state === "ready" ? status.result : null;
  const segments = useMemo(() => result?.segments ?? [], [result]);

  const activeIndex = useMemo(
    () => (segments.length ? findActiveIndex(segments, playback.currentTime) : -1),
    [segments, playback.currentTime],
  );

  const activeChord = activeIndex >= 0 ? segments[activeIndex].symbol : NO_CHORD;
  const chordNotes = useMemo(() => getChordNotes(activeChord), [activeChord]);

  return (
    <div className="flex h-full flex-col" {...dragProps}>
      <header className="flex items-center justify-between border-b border-separator px-5 py-2.5">
        <h1 className="text-sm font-semibold">Chord Finder</h1>
        {status.state !== "loading" ? (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90 [&_svg]:size-4"
          >
            <MusicIcon />
            Open Song…
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1">
        {isDragging ? <DropOverlay /> : null}

        {status.state === "idle" ? <DropZoneEmpty onPick={openPicker} /> : null}

        {status.state === "loading" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="text-sm font-semibold">{STAGE_LABEL[status.stage]}</span>
            <div className="h-1.5 w-64 overflow-hidden rounded-full bg-well">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <span className="max-w-72 truncate text-small text-tertiary">{status.fileName}</span>
            <button
              type="button"
              onClick={reset}
              className="mt-1 rounded-md px-3 py-1 text-small text-tertiary transition-colors hover:bg-control-subtle hover:text-primary"
            >
              Cancel
            </button>
          </div>
        ) : null}

        {status.state === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8">
            <div className="max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-small text-red-700 dark:text-red-300">
              {status.message}
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast transition-opacity hover:opacity-90 [&_svg]:size-4"
            >
              <MusicIcon />
              Try Another File
            </button>
          </div>
        ) : null}

        {status.state === "ready" && result ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-8 border-b border-separator px-5 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold">{status.fileName}</span>
                <span className="text-mini text-tertiary tabular-nums">
                  {formatTime(result.durationSec)} · {segments.length} chords
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-8">
                <Stat label="Key" value={`${result.key.tonic} ${result.key.scale}`} />
                <Stat label="Tempo" value={`${result.bpm} BPM`} />
                <Stat label="Chord" value={activeChord} accent />
                <Stat
                  label="Notes"
                  value={
                    chordNotes.notes.length
                      ? chordNotes.notes
                          .map((n) => n.name.replace("#", "♯").replace("b", "♭"))
                          .join(" · ")
                      : "—"
                  }
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-4">
              <Piano2D notes={chordNotes.notes} rootPc={chordNotes.rootPc} />
            </div>

            <ChordTimeline segments={segments} activeIndex={activeIndex} onSeek={playback.seek} />
            <TransportBar playback={playback} />
            <audio ref={setAudioEl} src={status.audioUrl} preload="auto" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
