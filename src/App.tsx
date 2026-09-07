import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AudioWaveformIcon,
  FolderOpenIcon,
  MusicIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { Note } from "tonal";

import {
  DEFAULT_TIME_SIGNATURE,
  TIME_SIGNATURES,
  buildBeatMap,
  downbeatTimes,
  estimateDownbeatPhase,
  formatTimeSignature,
  parseTimeSignature,
  snapSections,
} from "./analysis/beat-map";
import { getHarmonicFunction } from "./analysis/harmonic-function";
import { transposeChordSymbol } from "./analysis/chord-notes";
import { NO_CHORD } from "./analysis/classify-chords";
import {
  describeProvenance,
  isRootOnly,
  ORIGINAL_MIX_SOURCE,
} from "./analysis/provenance";
import { analyzeChordBlob, useAnalysis } from "./analysis/use-analysis";
import { renderAndDownloadMix, type ExportFormat } from "./audio/export-mix";
import { ChordWorkbench } from "./components/chord-workbench";
import { DropOverlay, DropZoneEmpty, useFileImport } from "./components/drop-zone";
import { MusicSources } from "./components/music-sources";
import { PracticeTransport } from "./components/practice-transport";
import { SessionTimeline } from "./components/session-timeline";
import {
  StemMixer,
  type ChordSourceStatus,
  type MixExportStatus,
} from "./components/stem-mixer";
import { useMetronome } from "./components/use-metronome";
import { formatTime, usePlayback } from "./components/use-playback";
import { ORIGINAL_MIX_TRACK_ID, useStemMixer } from "./components/use-stem-mixer";
import { useSeparation } from "./separation/use-separation";
import type {
  AnalysisStage,
  ChordAnalysisMode,
  ChordSegment,
  DerivedChords,
  SectionSegment,
  TimeSignature,
} from "./types";

const STAGE_LABEL: Record<AnalysisStage, string> = {
  decoding: "Decoding audio",
  extracting: "Mapping key and pulse",
  chords: "Reading the progression",
  done: "Building your session",
};

const STAGES: AnalysisStage[] = ["decoding", "extracting", "chords", "done"];
const KEY_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"] as const;

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

/**
 * Name overrides are keyed by the detected start time, not by index: snapping
 * boundaries onto a new bar grid can merge sections and renumber them, but the
 * time the detector reported never moves.
 */
function sectionKey(section: SectionSegment): string {
  return section.startSec.toFixed(3);
}

function findActiveSectionIndex(sections: SectionSegment[], time: number): number {
  return sections.findIndex((section) => time >= section.startSec && time < section.endSec);
}

function transposeSegment(
  segment: ChordSegment,
  semitones: number,
  preferFlats: boolean,
): ChordSegment {
  if (semitones === 0 && !preferFlats) return segment;
  return { ...segment, symbol: transposeChordSymbol(segment.symbol, semitones, preferFlats) };
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</span>
      <span className={`data-value text-sm font-semibold ${accent ? "text-accent" : "text-primary"}`}>{value}</span>
    </div>
  );
}

function KeyPicker({
  tonic,
  scale,
  semitones,
  onChange,
}: {
  tonic: string;
  scale: string;
  semitones: number;
  onChange: (pitchClass: number) => void;
}) {
  const pitchClass = Note.chroma(tonic) ?? 0;
  return (
    <label className="flex shrink-0 flex-col gap-0.5">
      <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-tertiary">Song key</span>
      <span className="flex items-center gap-1.5">
        <select
          value={pitchClass}
          onChange={(event) => onChange(Number(event.target.value))}
          className="-ml-1 rounded bg-transparent px-1 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Transpose song to key"
        >
          {KEY_NAMES.map((name, index) => <option key={name} value={index}>{name} {scale}</option>)}
        </select>
        {semitones !== 0 ? <span className="text-[9px] font-semibold tabular-nums text-accent">{semitones > 0 ? "+" : ""}{semitones} st</span> : null}
      </span>
    </label>
  );
}

function TimeSignaturePicker({
  value,
  onChange,
}: {
  value: TimeSignature;
  onChange: (signature: TimeSignature) => void;
}) {
  const hintId = `${useId().replace(/:/g, "")}-metre-hint`;
  return (
    // The hint is associated with the select and shown on focus as well as
    // hover: metre is *not* detected, and a title attribute never reaches a
    // keyboard or touch user, who are the ones most likely to be surprised
    // that every bar number on screen depends on this control.
    <label className="group relative flex shrink-0 flex-col gap-0.5">
      <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-tertiary">Metre</span>
      <select
        value={formatTimeSignature(value)}
        onChange={(event) => onChange(parseTimeSignature(event.target.value))}
        className="-ml-1 rounded bg-transparent px-1 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Time signature"
        aria-describedby={hintId}
      >
        {TIME_SIGNATURES.map((signature) => {
          const label = formatTimeSignature(signature);
          return <option key={label} value={label}>{label}</option>;
        })}
      </select>
      <span
        id={hintId}
        role="note"
        className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-56 rounded-md border border-separator bg-control px-2 py-1.5 text-mini text-secondary shadow-lg group-focus-within:block group-hover:block"
      >
        Defaults to 4/4 and is your choice, not detected. Bar numbers and the click accent follow it.
      </span>
    </label>
  );
}

export function App() {
  const { status, analyzeFile, reset } = useAnalysis();
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  // Keyed by track id, and holding the decoder record alongside the segments.
  // The two chord decoders produce incompatible output and which one ran is
  // not recoverable from the segments, so it travels with them.
  const [segmentSets, setSegmentSets] = useState<Record<string, DerivedChords>>({});
  const [chordSourceId, setChordSourceId] = useState(ORIGINAL_MIX_TRACK_ID);
  const [chordSourceStatus, setChordSourceStatus] = useState<ChordSourceStatus>({ state: "idle" });
  const [capo, setCapo] = useState(0);
  const [transposeSemitones, setTransposeSemitones] = useState(0);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>(DEFAULT_TIME_SIGNATURE);
  const [sectionNames, setSectionNames] = useState<Record<string, string>>({});
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [exportStatus, setExportStatus] = useState<MixExportStatus>({ state: "idle" });
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileMixerOpen, setMobileMixerOpen] = useState(false);
  const chordAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const exportJobRef = useRef(0);
  const playbackTimeRef = useRef(0);
  const mobileMixerButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMixerCloseRef = useRef<HTMLButtonElement>(null);
  const mobileMixerDialogRef = useRef<HTMLElement>(null);
  const { isDragging, dragProps, openPicker } = useFileImport({ onFile: analyzeFile });

  const result = status.state === "ready" ? status.result : null;
  const sourceKey = status.state === "ready" ? status.audioUrl : status.state;
  const sourceFile = status.state === "ready" ? status.sourceFile : null;
  const playback = usePlayback(audioEl, true);
  playbackTimeRef.current = playback.currentTime;
  const stemMixer = useStemMixer(
    audioEl,
    sourceKey,
    playback.playbackRate,
    sourceFile,
    transposeSemitones,
  );
  // Bar phase is estimated from the *original mix* chords on purpose. Deriving
  // it from whichever stem is currently selected would shift the bar grid every
  // time the musician changed chord source, which is worse than being slightly
  // less certain.
  const downbeatPhase = useMemo(
    () => (result ? estimateDownbeatPhase(result.beats, result.segments, timeSignature) : 0),
    [result, timeSignature],
  );
  const beatMap = useMemo(
    () => (result ? buildBeatMap(result.beats, timeSignature, downbeatPhase) : []),
    [downbeatPhase, result, timeSignature],
  );
  const keyedSections = useMemo(() => {
    if (!result) return [];
    const named = result.sections.map((section) => {
      const override = sectionNames[sectionKey(section)];
      return {
        ...section,
        label: override ?? section.label,
        edited: Boolean(override) || Boolean(section.edited),
        detectedKey: sectionKey(section),
      };
    });
    return snapSections(named, downbeatTimes(beatMap));
  }, [beatMap, result, sectionNames]);
  const sections = useMemo<SectionSegment[]>(
    () => keyedSections.map(({ detectedKey: _detectedKey, ...section }) => section),
    [keyedSections],
  );

  const metronome = useMetronome({
    audio: audioEl,
    beatMap,
    isPlaying: playback.isPlaying,
    playbackRate: playback.playbackRate,
    sourceLatencySec: stemMixer.sourceLatencySec,
  });
  const separation = useSeparation(stemMixer.addAssets);

  useEffect(() => {
    playback.setSourceLatency(stemMixer.sourceLatencySec);
  }, [playback.setSourceLatency, stemMixer.sourceLatencySec]);

  const exportSelectionKey = useMemo(() => stemMixer.tracks.map((track) => [
    track.id,
    track.volume,
    track.muted,
    track.solo,
    track.loadState,
    track.durationMismatch,
  ].join(":")).join("|"), [stemMixer.tracks]);

  useEffect(() => {
    separation.reset();
  }, [separation.reset, sourceKey]);

  useEffect(() => {
    chordAbortRef.current?.abort();
    if (!result) {
      setSegmentSets({});
      return;
    }
    setSegmentSets({
      [ORIGINAL_MIX_TRACK_ID]: { segments: result.segments, provenance: result.provenance },
    });
    setChordSourceId(ORIGINAL_MIX_TRACK_ID);
    setChordSourceStatus({ state: "idle" });
    setTransposeSemitones(0);
    setCapo(0);
    // The result reports the metre the arrangement was read under; the picker
    // starts there rather than at a second, independent default.
    setTimeSignature(result.timeSignature);
    setSectionNames({});
    setExportStatus({ state: "idle" });
  }, [result]);

  useEffect(() => () => chordAbortRef.current?.abort(), []);

  useEffect(() => {
    exportJobRef.current += 1;
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    setExportStatus((current) => current.state === "idle" ? current : { state: "idle" });
  }, [exportFormat, exportSelectionKey, sourceKey, transposeSemitones]);

  useEffect(() => () => {
    exportJobRef.current += 1;
    exportAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!mobileMixerOpen) return;
    const focusTimer = window.setTimeout(() => mobileMixerCloseRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMixerOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = mobileMixerDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      if (mobileMixerButtonRef.current?.isConnected) mobileMixerButtonRef.current.focus();
    };
  }, [mobileMixerOpen]);

  // Removing a stem leaves its chord set unreachable; drop it rather than hold
  // a decoded array for a track that no longer exists. Re-adding the file gets
  // a fresh track id and is re-analyzed either way.
  useEffect(() => {
    const liveIds = new Set(stemMixer.tracks.map((track) => track.id));
    setSegmentSets((current) => {
      const kept = Object.entries(current).filter(([id]) => liveIds.has(id));
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [stemMixer.tracks]);

  useEffect(() => {
    if (stemMixer.tracks.some((track) => track.id === chordSourceId)) return;
    chordAbortRef.current?.abort();
    setChordSourceId(ORIGINAL_MIX_TRACK_ID);
    setChordSourceStatus({ state: "idle" });
  }, [chordSourceId, stemMixer.tracks]);

  const activeChords = segmentSets[chordSourceId] ?? null;
  const baseSegments = activeChords?.segments ?? [];
  const originalKeyPc = result ? Note.chroma(result.key.tonic) ?? 0 : 0;
  const selectedKeyPc = (originalKeyPc + transposeSemitones + 12) % 12;
  const selectedKeyLabel = KEY_NAMES[selectedKeyPc];
  const selectedKeyTonic = selectedKeyLabel.replace("♭", "b");
  // F major belongs to the flat key family (its signature contains Bb), even
  // though the tonic itself has no accidental.
  const preferFlats = selectedKeyLabel.includes("♭") || selectedKeyLabel === "F";
  const originalPreferFlats = Boolean(result?.key.tonic.includes("b") || result?.key.tonic.includes("♭"));
  const activeIndex = useMemo(
    () => (baseSegments.length ? findActiveIndex(baseSegments, playback.currentTime) : -1),
    [baseSegments, playback.currentTime],
  );
  const activeSectionIndex = useMemo(
    () => (sections.length ? findActiveSectionIndex(sections, playback.currentTime) : -1),
    [playback.currentTime, sections],
  );
  const activeBaseSegment = activeIndex >= 0 ? baseSegments[activeIndex] : null;
  const activeSegment = activeBaseSegment ? transposeSegment(activeBaseSegment, transposeSemitones, preferFlats) : null;
  const previousSegment = activeIndex > 0 ? transposeSegment(baseSegments[activeIndex - 1], transposeSemitones, preferFlats) : null;
  const nextSegment = activeIndex >= 0 && activeIndex < baseSegments.length - 1
    ? transposeSegment(baseSegments[activeIndex + 1], transposeSemitones, preferFlats)
    : null;
  const activeChord = activeSegment?.symbol ?? NO_CHORD;
  const capoShape = capo > 0 ? transposeChordSymbol(activeChord, -capo, preferFlats) : activeChord;
  const harmonicFunction = getHarmonicFunction(activeChord, selectedKeyTonic);
  const displaySegments = useMemo(
    () => baseSegments.map((segment) => transposeSegment(segment, transposeSemitones, preferFlats)),
    [baseSegments, preferFlats, transposeSemitones],
  );
  const sourceTrack = stemMixer.tracks.find((track) => track.id === chordSourceId);
  // Live name when the track is still in the mixer, so a rename is reflected;
  // the recorded name once it is gone, so the label never claims output came
  // from somewhere it did not.
  const sourceLabel = sourceTrack?.name ?? activeChords?.provenance.source ?? ORIGINAL_MIX_SOURCE;
  // Decoder identity comes only from the artifact. Deriving it from
  // `sourceTrack` left one render — between a stem's removal and the source
  // guard above — where root-only output was offered as editable chords.
  const rootOnlySource = isRootOnly(activeChords?.provenance);
  const sourceAnalysisMode: ChordAnalysisMode = rootOnlySource ? "bass-root" : "harmony";
  const sourceAttribution = activeChords ? describeProvenance(activeChords.provenance) : undefined;

  const updateChord = useCallback((symbol: string, target: ChordSegment) => {
    const storedSymbol = transposeChordSymbol(symbol, -transposeSemitones, originalPreferFlats);
    setSegmentSets((current) => {
      const existing = current[chordSourceId];
      if (!existing) return current;
      return {
        ...current,
        // An edit changes the symbol, not what decoded it: provenance is kept
        // verbatim so `edited` stays the only marker of the musician's hand.
        [chordSourceId]: {
          ...existing,
          segments: existing.segments.map((segment) =>
            segment.startSec === target.startSec && segment.endSec === target.endSec
              ? { ...segment, symbol: storedSymbol, edited: true }
              : segment),
        },
      };
    });
  }, [chordSourceId, originalPreferFlats, transposeSemitones]);

  const renameSection = useCallback((index: number, label: string) => {
    const target = keyedSections[index];
    if (!target) return;
    setSectionNames((current) => ({ ...current, [target.detectedKey]: label }));
  }, [keyedSections]);

  const loopSection = useCallback((section: SectionSegment) => {
    playback.setLoop(section.startSec, section.endSec);
    playback.seek(section.startSec);
  }, [playback.seek, playback.setLoop]);

  const requestChordEdit = (index: number) => {
    if (rootOnlySource) return;
    const segment = baseSegments[index];
    if (!segment) return;
    playback.seek(segment.startSec + 0.001);
    setEditRequest((request) => ({
      sourceKey: `${sourceKey}:${chordSourceId}`,
      token: (request?.token ?? 0) + 1,
    }));
  };

  const changeSongKey = (targetPitchClass: number) => {
    let interval = (targetPitchClass - originalKeyPc + 12) % 12;
    if (interval > 6) interval -= 12;
    setTransposeSemitones(interval);
    setExportStatus({ state: "idle" });
  };

  const changeChordSource = useCallback(async (trackId: string) => {
    chordAbortRef.current?.abort();
    setChordSourceId(trackId);
    if (trackId === ORIGINAL_MIX_TRACK_ID || segmentSets[trackId]) {
      setChordSourceStatus({ state: "idle" });
      return;
    }
    const asset = stemMixer.getTrackAsset(trackId);
    if (!asset || !result) {
      setChordSourceStatus({ state: "error", trackId, message: "This track is not ready for chord analysis." });
      return;
    }
    const abort = new AbortController();
    chordAbortRef.current = abort;
    setChordSourceStatus({ state: "loading", trackId, progress: 0 });
    try {
      const derived = await analyzeChordBlob(asset.blob, {
        beats: result.beats,
        source: asset.track.name,
        analysisMode: asset.track.kind === "bass" ? "bass-root" : "harmony",
        onProgress: (progress) => setChordSourceStatus({ state: "loading", trackId, progress }),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      setSegmentSets((current) => ({ ...current, [trackId]: derived }));
      setChordSourceStatus({ state: "idle" });
    } catch (error) {
      if (abort.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setChordSourceStatus({
        state: "error",
        trackId,
        message: error instanceof Error ? error.message : "Could not analyze chords from this stem.",
      });
    }
  }, [result, segmentSets, stemMixer]);

  const separateSong = () => {
    if (sourceFile && result) void separation.separate(sourceFile, result.durationSec);
  };

  const exportMix = useCallback(async () => {
    if (!result || status.state !== "ready") return;
    exportAbortRef.current?.abort();
    const abort = new AbortController();
    const jobId = ++exportJobRef.current;
    exportAbortRef.current = abort;
    const assets = stemMixer.getAudibleAssets();
    setExportStatus({ state: "working", stage: "decoding", progress: 0 });
    try {
      await renderAndDownloadMix({
        tracks: assets.map(({ track, blob }) => ({ name: track.name, blob, volume: track.volume })),
        durationSec: result.durationSec,
        pitchSemitones: transposeSemitones,
        format: exportFormat,
        sessionName: status.fileName,
        signal: abort.signal,
        onProgress: (stage, progress) => {
          if (exportJobRef.current === jobId && !abort.signal.aborted) {
            setExportStatus({ state: "working", stage, progress });
          }
        },
      });
      if (exportJobRef.current === jobId && !abort.signal.aborted) setExportStatus({ state: "done" });
    } catch (error) {
      if (exportJobRef.current !== jobId || abort.signal.aborted) return;
      setExportStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (exportJobRef.current === jobId) exportAbortRef.current = null;
    }
  }, [exportFormat, result, status, stemMixer.getAudibleAssets, transposeSemitones]);

  const {
    clearLoop,
    loopEnd,
    loopStart,
    setLoopEnd,
    setLoopStart,
    skip,
    toggle: togglePlayback,
  } = playback;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (status.state !== "ready") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName) || target.closest('[role="slider"]'))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        skip(-5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        skip(5);
      } else if (event.key.toLowerCase() === "m") {
        metronome.toggle();
      } else if (event.key.toLowerCase() === "l") {
        const playhead = playbackTimeRef.current;
        if (loopStart === null) setLoopStart(playhead);
        else if (loopEnd === null) setLoopEnd(playhead);
        else clearLoop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearLoop, loopEnd, loopStart, metronome.toggle, setLoopEnd, setLoopStart, skip, status.state, togglePlayback]);

  return (
    <div className="app-shell flex h-full flex-col" {...dragProps}>
      <a href="#main-content" className="skip-link">Skip to session</a>
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-separator bg-background/90 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent"><AudioWaveformIcon className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-sm font-semibold tracking-[-0.025em]">Chord Finder</h1>
            <p className="hidden text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-tertiary sm:block">Instrument practice studio</p>
          </div>
          <span className="ml-1 hidden items-center gap-1 rounded-full border border-separator bg-control-subtle px-2 py-1 text-[0.625rem] font-medium text-tertiary md:inline-flex"><ShieldCheckIcon className="size-3 text-accent" aria-hidden="true" />Audio stays local</span>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSourcesOpen(true)} className="tool-button min-h-9"><MusicIcon /> <span className="hidden sm:inline">Music sources</span><span className="sm:hidden">Sources</span></button>
          <a
            href={new URL("legal/index.html", document.baseURI).href}
            target="_blank"
            rel="noreferrer"
            className="tool-button hidden min-h-9 md:inline-flex"
            aria-label="Source code and licenses"
            title="Source code and licenses"
          >
            <ScaleIcon aria-hidden="true" />
            <span className="hidden xl:inline">Source &amp; licenses</span>
          </a>
          {status.state !== "loading" ? (
            <button type="button" onClick={openPicker} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-accent px-3.5 text-xs font-semibold text-accent-contrast transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:h-9 [&_svg]:size-4"><FolderOpenIcon aria-hidden="true" /><span className="hidden sm:inline">Open song</span><span className="sm:hidden">Open</span></button>
          ) : null}
        </div>
      </header>

      <main id="main-content" className="relative min-h-0 flex-1" tabIndex={-1}>
        {isDragging ? <DropOverlay /> : null}
        {status.state === "idle" ? <div className="idle-glow absolute inset-0"><DropZoneEmpty onPick={openPicker} /></div> : null}
        {status.state === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center px-5">
            <section className="studio-panel w-[calc(100vw-2rem)] max-w-lg rounded-2xl p-6 sm:p-8">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><AudioWaveformIcon className="size-4 animate-pulse" aria-hidden="true" /></span>
                <div className="min-w-0"><h2 className="text-base font-semibold" role="status" aria-live="polite" aria-atomic="true">{STAGE_LABEL[status.stage]}</h2><p className="mt-0.5 truncate text-small text-tertiary">{status.fileName}</p></div>
                <output className="ml-auto font-mono text-xs text-accent tabular-nums">{Math.round(status.progress * 100)}%</output>
              </div>
              <div className="mt-5 h-1 overflow-hidden rounded-full bg-well" role="progressbar" aria-label="Song analysis" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.progress * 100)}><div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(status.progress * 100)}%` }} /></div>
              <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Analysis progress">
                {STAGES.map((stage, index) => {
                  const current = STAGES.indexOf(status.stage);
                  return <li key={stage} className={`rounded-md px-1.5 py-1 text-center text-[0.5625rem] font-semibold uppercase tracking-[0.08em] ${index <= current ? "bg-accent/10 text-accent" : "bg-well text-quaternary"}`}>{stage === "extracting" ? "Pulse" : stage}</li>;
                })}
              </ol>
              <button type="button" onClick={reset} className="tool-button mt-5">Cancel analysis</button>
            </section>
          </div>
        ) : null}
        {status.state === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6"><div role="alert" className="max-w-lg rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-small text-red-200">{status.message}</div><button type="button" onClick={openPicker} className="tool-button tool-button-active"><FolderOpenIcon /> Try another file</button></div>
        ) : null}

        {status.state === "ready" && result ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:grid-rows-1">
            <aside data-stem-panel className="hidden min-h-0 border-r border-separator bg-well/55 p-3 lg:block">
              <StemMixer
                {...stemMixer}
                chordSourceId={chordSourceId}
                chordSourceStatus={chordSourceStatus}
                onChordSourceChange={(trackId) => void changeChordSource(trackId)}
                separationStatus={separation.status}
                onSeparate={separateSong}
                onCancelSeparation={separation.cancel}
                exportFormat={exportFormat}
                onExportFormatChange={setExportFormat}
                exportStatus={exportStatus}
                onExport={() => void exportMix()}
                className="h-full"
              />
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div data-session-header className="flex shrink-0 flex-col gap-2 border-b border-separator px-4 py-2.5 sm:px-5 lg:min-h-16 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
                <div data-session-heading className="flex min-w-0 flex-1 items-center gap-2">
                  <div data-session-title className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold" title={status.fileName}>{status.fileName}</h2>
                    <p className="mt-0.5 text-mini text-tertiary tabular-nums" title={sourceAttribution}>
                      {formatTime(result.durationSec)} · {baseSegments.length} {rootOnlySource ? "root regions · roots" : "chord regions · chords"} from {sourceLabel}
                      {sections.length > 0
                        ? ` · ${sections.length} sections`
                        : " · no distinct sections detected"}
                    </p>
                  </div>
                  <button
                    ref={mobileMixerButtonRef}
                    type="button"
                    onClick={() => setMobileMixerOpen(true)}
                    className="tool-button shrink-0 lg:hidden"
                    aria-haspopup="dialog"
                  >
                    <SlidersHorizontalIcon aria-hidden="true" /> Mixer
                  </button>
                </div>
                <div data-session-stats className="grid w-full shrink-0 grid-cols-3 gap-x-4 gap-y-1 border-t border-separator pt-2 sm:grid-cols-3 lg:flex lg:w-auto lg:items-center lg:gap-7 lg:border-t-0 lg:pt-0">
                  <Stat
                    label={rootOnlySource ? "Root" : capo > 0 ? `Capo ${capo} shape` : "Chord"}
                    value={rootOnlySource ? activeChord : capoShape}
                    accent
                  />
                  <Stat label="Number · solfa" value={harmonicFunction.shortLabel} />
                  {/* Row 1 is what changes as the song plays; row 2 is session
                      controls. Grouping them this way is also what makes it
                      clear that the confidence belongs to the chord. */}
                  <Stat label="Chord confidence" value={activeBaseSegment ? activeBaseSegment.edited ? "Edited" : `${Math.round(activeBaseSegment.confidence * 100)}%` : "—"} />
                  <KeyPicker tonic={selectedKeyTonic} scale={result.key.scale} semitones={transposeSemitones} onChange={changeSongKey} />
                  <Stat label="Tempo" value={`${result.bpm} BPM`} />
                  <TimeSignaturePicker value={timeSignature} onChange={setTimeSignature} />
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
                <div className="shrink-0 p-3 sm:p-4">
                  <SessionTimeline waveform={result.waveform} segments={displaySegments} duration={result.durationSec} currentTime={playback.currentTime} activeIndex={activeIndex} loopStart={playback.loopStart} loopEnd={playback.loopEnd} onSeek={playback.seek} onEditChord={rootOnlySource ? undefined : requestChordEdit} keyTonic={selectedKeyTonic} analysisMode={sourceAnalysisMode} sections={sections} activeSectionIndex={activeSectionIndex} beatMap={beatMap} onLoopSection={loopSection} onRenameSection={renameSection} analysisKey={`${sourceKey}:${chordSourceId}`} metreKey={formatTimeSignature(timeSignature)} />
                </div>
                <ChordWorkbench
                  key={`${sourceKey}:${chordSourceId}`}
                  segment={activeSegment}
                  previousSegment={previousSegment}
                  nextSegment={nextSegment}
                  keyTonic={selectedKeyTonic}
                  sourceLabel={sourceLabel}
                  analysisMode={sourceAnalysisMode}
                  capo={capo}
                  onChangeChord={updateChord}
                  editRequested={!rootOnlySource && editRequest?.sourceKey === `${sourceKey}:${chordSourceId}` ? editRequest.token : undefined}
                />
              </div>

              <PracticeTransport playback={playback} metronome={metronome} capo={capo} onCapoChange={setCapo} />
              <audio ref={setAudioEl} src={status.audioUrl} preload="auto" />
            </div>
          </div>
        ) : null}
      </main>
      <MusicSources open={sourcesOpen} onClose={() => setSourcesOpen(false)} onOpenFile={openPicker} />
      {mobileMixerOpen && status.state === "ready" ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMobileMixerOpen(false);
          }}
        >
          <section
            ref={mobileMixerDialogRef}
            className="flex h-full w-full max-w-md flex-col border-l border-separator bg-background shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-mixer-title"
          >
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-separator px-4">
              <div>
                <h2 id="mobile-mixer-title" className="text-sm font-semibold">Stem mixer</h2>
                <p className="text-mini text-tertiary">Separate, isolate, analyze, and export</p>
              </div>
              <button
                ref={mobileMixerCloseRef}
                type="button"
                onClick={() => {
                  setMobileMixerOpen(false);
                }}
                className="transport-icon"
                aria-label="Close stem mixer"
              >
                <XIcon aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 p-3">
              <StemMixer
                {...stemMixer}
                chordSourceId={chordSourceId}
                chordSourceStatus={chordSourceStatus}
                onChordSourceChange={(trackId) => void changeChordSource(trackId)}
                separationStatus={separation.status}
                onSeparate={separateSong}
                onCancelSeparation={separation.cancel}
                exportFormat={exportFormat}
                onExportFormatChange={setExportFormat}
                exportStatus={exportStatus}
                onExport={() => void exportMix()}
                className="h-full"
              />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
