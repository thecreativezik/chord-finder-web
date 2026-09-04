import { useEffect, useMemo, useState } from "react";
import { AudioWaveformIcon, FolderOpenIcon, ShieldCheckIcon } from "lucide-react";

import { transposeChordSymbol } from "./analysis/chord-notes";
import { NO_CHORD } from "./analysis/classify-chords";
import { useAnalysis } from "./analysis/use-analysis";
import { ChordWorkbench } from "./components/chord-workbench";
import { DropOverlay, DropZoneEmpty, useFileImport } from "./components/drop-zone";
import { PracticeTransport } from "./components/practice-transport";
import { SessionTimeline } from "./components/session-timeline";
import { StemMixer } from "./components/stem-mixer";
import { useMetronome } from "./components/use-metronome";
import { formatTime, usePlayback } from "./components/use-playback";
import { useStemMixer } from "./components/use-stem-mixer";
import type { AnalysisStage, ChordSegment } from "./types";

const STAGE_LABEL: Record<AnalysisStage, string> = {
  decoding: "Decoding audio",
  extracting: "Mapping key and pulse",
  chords: "Reading the progression",
  done: "Building your session",
};

const STAGES: AnalysisStage[] = ["decoding", "extracting", "chords", "done"];

interface EditRequest {
  sourceKey: string;
  token: number;
}

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
    <div className="flex shrink-0 flex-col gap-0.5">
      <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-tertiary">
        {label}
      </span>
      <span className={`data-value text-sm font-semibold ${accent ? "text-accent" : "text-primary"}`}>
        {value}
      </span>
    </div>
  );
}

export function App() {
  const { status, analyzeFile, reset } = useAnalysis();
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [segments, setSegments] = useState<ChordSegment[]>([]);
  const [capo, setCapo] = useState(0);
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const { isDragging, dragProps, openPicker } = useFileImport({ onFile: analyzeFile });

  const result = status.state === "ready" ? status.result : null;
  const sourceKey = status.state === "ready" ? status.audioUrl : status.state;
  const playback = usePlayback(audioEl);
  const metronome = useMetronome({
    audio: audioEl,
    beats: result?.beats ?? [],
    isPlaying: playback.isPlaying,
    playbackRate: playback.playbackRate,
  });
  const stemMixer = useStemMixer(audioEl, sourceKey, playback.playbackRate);

  useEffect(() => {
    setSegments(result?.segments ?? []);
    setCapo(0);
  }, [result]);

  const activeIndex = useMemo(
    () => (segments.length ? findActiveIndex(segments, playback.currentTime) : -1),
    [segments, playback.currentTime],
  );
  const activeSegment = activeIndex >= 0 ? segments[activeIndex] : null;
  const activeChord = activeSegment?.symbol ?? NO_CHORD;
  const capoShape = capo > 0 ? transposeChordSymbol(activeChord, -capo) : activeChord;
  const displaySegments = useMemo(
    () =>
      capo > 0
        ? segments.map((segment) => ({
            ...segment,
            symbol: transposeChordSymbol(segment.symbol, -capo),
          }))
        : segments,
    [capo, segments],
  );

  const updateChord = (symbol: string, target: ChordSegment) => {
    setSegments((current) =>
      current.map((segment) =>
        segment === target ||
        (segment.startSec === target.startSec && segment.endSec === target.endSec)
          ? { ...segment, symbol, edited: true }
          : segment,
      ),
    );
  };

  const requestChordEdit = (index: number) => {
    const segment = segments[index];
    if (!segment) return;
    playback.seek(segment.startSec + 0.001);
    setEditRequest((request) => ({
      sourceKey,
      token: (request?.token ?? 0) + 1,
    }));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (status.state !== "ready") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName) ||
          target.closest('[role="slider"]'))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.code === "Space") {
        event.preventDefault();
        playback.toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        playback.skip(-5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        playback.skip(5);
      } else if (event.key.toLowerCase() === "m") {
        metronome.toggle();
      } else if (event.key.toLowerCase() === "l") {
        const playhead = audioEl?.currentTime ?? playback.currentTime;
        if (playback.loopStart === null) playback.setLoopStart(playhead);
        else if (playback.loopEnd === null) playback.setLoopEnd(playhead);
        else playback.clearLoop();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    audioEl,
    metronome.toggle,
    playback.clearLoop,
    playback.loopEnd,
    playback.loopStart,
    playback.setLoopEnd,
    playback.setLoopStart,
    playback.skip,
    playback.toggle,
    status.state,
  ]);

  return (
    <div className="app-shell flex h-full flex-col" {...dragProps}>
      <a href="#main-content" className="skip-link">Skip to session</a>

      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-separator bg-background/90 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
            <AudioWaveformIcon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-sm font-semibold tracking-[-0.025em]">Chord Finder</h1>
            <p className="hidden text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-tertiary sm:block">
              Instrument practice studio
            </p>
          </div>
          <span className="ml-1 hidden items-center gap-1 rounded-full border border-separator bg-control-subtle px-2 py-1 text-[0.625rem] font-medium text-tertiary md:inline-flex">
            <ShieldCheckIcon className="size-3 text-accent" aria-hidden="true" />
            Local processing
          </span>
        </div>

        {status.state !== "loading" ? (
          <button
            type="button"
            onClick={openPicker}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 text-xs font-semibold text-accent-contrast transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-9 [&_svg]:size-4"
          >
            <FolderOpenIcon aria-hidden="true" />
            <span className="hidden sm:inline">Open song</span>
            <span className="sm:hidden">Open</span>
          </button>
        ) : null}
      </header>

      <main id="main-content" className="relative min-h-0 flex-1" tabIndex={-1}>
        {isDragging ? <DropOverlay /> : null}

        {status.state === "idle" ? (
          <div className="idle-glow absolute inset-0">
            <DropZoneEmpty onPick={openPicker} />
          </div>
        ) : null}

        {status.state === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center px-5">
            <section className="studio-panel w-[calc(100vw-2rem)] max-w-lg rounded-2xl p-6 sm:p-8">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <AudioWaveformIcon className="size-4 animate-pulse" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold" role="status" aria-live="polite" aria-atomic="true">
                    {STAGE_LABEL[status.stage]}
                  </h2>
                  <p className="mt-0.5 truncate text-small text-tertiary">{status.fileName}</p>
                </div>
                <output className="ml-auto font-mono text-xs text-accent tabular-nums">
                  {Math.round(status.progress * 100)}%
                </output>
              </div>

              <div
                className="mt-5 h-1 overflow-hidden rounded-full bg-well"
                role="progressbar"
                aria-label="Song analysis"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(status.progress * 100)}
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200"
                  style={{ width: `${Math.round(status.progress * 100)}%` }}
                />
              </div>
              <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Analysis progress">
                {STAGES.map((stage, index) => {
                  const current = STAGES.indexOf(status.stage);
                  return (
                    <li
                      key={stage}
                      className={`rounded-md px-1.5 py-1 text-center text-[0.5625rem] font-semibold uppercase tracking-[0.08em] ${
                        index <= current ? "bg-accent/10 text-accent" : "bg-well text-quaternary"
                      }`}
                    >
                      {stage === "extracting" ? "Pulse" : stage}
                    </li>
                  );
                })}
              </ol>
              <button type="button" onClick={reset} className="tool-button mt-5">Cancel analysis</button>
            </section>
          </div>
        ) : null}

        {status.state === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <div role="alert" className="max-w-lg rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-small text-red-200">
              {status.message}
            </div>
            <button type="button" onClick={openPicker} className="tool-button tool-button-active">
              <FolderOpenIcon /> Try another file
            </button>
          </div>
        ) : null}

        {status.state === "ready" && result ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:grid-rows-1">
            <aside
              data-stem-panel
              className="h-40 shrink-0 border-b border-separator bg-well/55 p-3 sm:h-44 lg:h-auto lg:min-h-0 lg:border-b-0 lg:border-r"
            >
              <StemMixer {...stemMixer} className="h-full" />
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                data-session-header
                className="flex shrink-0 flex-col gap-2 border-b border-separator px-4 py-2.5 sm:px-5 lg:min-h-16 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
              >
                <div data-session-title className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold" title={status.fileName}>{status.fileName}</h2>
                  <p className="mt-0.5 text-mini text-tertiary tabular-nums">
                    {formatTime(result.durationSec)} · {segments.length} chord regions · {(result.sampleRate / 1_000).toFixed(1)} kHz
                  </p>
                </div>
                <div
                  data-session-stats
                  className="grid w-full shrink-0 grid-cols-2 gap-x-4 gap-y-1 border-t border-separator pt-2 sm:grid-cols-4 lg:flex lg:w-auto lg:items-center lg:gap-8 lg:border-t-0 lg:pt-0"
                >
                  <Stat label={capo > 0 ? `Capo ${capo} symbol` : "Chord"} value={capoShape} accent />
                  <Stat label="Key" value={`${result.key.tonic} ${result.key.scale}`} />
                  <Stat label="Tempo" value={`${result.bpm} BPM`} />
                  <Stat
                    label="Confidence"
                    value={
                      activeSegment
                        ? activeSegment.edited
                          ? "Edited"
                          : `${Math.round(activeSegment.confidence * 100)}%`
                        : "—"
                    }
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="p-3 sm:p-4">
                  <SessionTimeline
                    waveform={result.waveform}
                    segments={displaySegments}
                    duration={result.durationSec}
                    currentTime={playback.currentTime}
                    activeIndex={activeIndex}
                    loopStart={playback.loopStart}
                    loopEnd={playback.loopEnd}
                    onSeek={playback.seek}
                    onEditChord={requestChordEdit}
                  />
                </div>
                <ChordWorkbench
                  segment={activeSegment}
                  capo={capo}
                  onChangeChord={updateChord}
                  editRequested={editRequest?.sourceKey === sourceKey ? editRequest.token : undefined}
                />
              </div>

              <PracticeTransport
                playback={playback}
                metronome={metronome}
                capo={capo}
                onCapoChange={setCapo}
              />
              <audio ref={setAudioEl} src={status.audioUrl} preload="auto" />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
