import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import { getHarmonicFunction } from "../analysis/harmonic-function";
import { getChordNotes, transposeChordSymbol } from "../analysis/chord-notes";
import { NO_CHORD } from "../analysis/classify-chords";
import { BassFretboard, GuitarFretboard } from "../instruments";
import { Piano2D } from "../keyboard/piano-2d";
import type { ChordAnalysisMode, ChordSegment } from "../types";
import { formatTime } from "./use-playback";

interface ChordWorkbenchProps {
  segment: ChordSegment | null;
  capo: number;
  onChangeChord: (symbol: string, segment: ChordSegment) => void;
  editRequested?: number;
  keyTonic: string;
  previousSegment: ChordSegment | null;
  nextSegment: ChordSegment | null;
  sourceLabel: string;
  analysisMode: ChordAnalysisMode;
}

function normalizeChordSymbol(symbol: string): string {
  return symbol.trim().replace(/♯/g, "#").replace(/♭/g, "b");
}

function ProgressionCell({
  label,
  segment,
  keyTonic,
  active = false,
}: {
  label: string;
  segment: ChordSegment | null;
  keyTonic: string;
  active?: boolean;
}) {
  const symbol = segment?.symbol ?? NO_CHORD;
  const harmonic = getHarmonicFunction(symbol, keyTonic);
  return (
    <div
      className={`min-w-0 rounded-lg border px-3 py-2.5 ${
        active ? "border-accent/45 bg-accent/10" : "border-separator bg-well/75"
      }`}
    >
      <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</span>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <strong className={`truncate text-lg ${active ? "text-accent" : "text-secondary"}`}>{symbol}</strong>
        <span className="shrink-0 text-[10px] font-semibold text-tertiary">{harmonic.shortLabel}</span>
      </div>
    </div>
  );
}

export function ChordWorkbench({
  segment,
  capo,
  onChangeChord,
  editRequested,
  keyTonic,
  previousSegment,
  nextSegment,
  sourceLabel,
  analysisMode,
}: ChordWorkbenchProps) {
  const symbol = segment?.symbol ?? NO_CHORD;
  const rootOnly = analysisMode === "bass-root";
  const [editing, setEditing] = useState(false);
  const [instrumentView, setInstrumentView] = useState<"piano" | "guitar" | "bass">("piano");
  const [draft, setDraft] = useState(symbol);
  const [editTarget, setEditTarget] = useState<ChordSegment | null>(null);
  const handledRequest = useRef<number | undefined>(undefined);
  const preferFlats = keyTonic.includes("b") || keyTonic === "F";
  const chordNotes = useMemo(() => {
    const parsed = getChordNotes(symbol, preferFlats);
    if (!rootOnly || parsed.rootPc === null) return parsed;
    const root = parsed.notes.find((note) => note.pc === parsed.rootPc);
    return {
      notes: root ? [root] : [],
      pitchClasses: root ? [root.pc] : [],
      rootPc: parsed.rootPc,
    };
  }, [preferFlats, rootOnly, symbol]);
  const normalizedDraft = normalizeChordSymbol(draft);
  const draftNotes = useMemo(() => getChordNotes(normalizedDraft), [normalizedDraft]);
  const validDraft = normalizedDraft === NO_CHORD || draftNotes.notes.length > 0;
  const shape = capo > 0 ? transposeChordSymbol(symbol, -capo, preferFlats) : symbol;
  const harmonicFunction = getHarmonicFunction(symbol, keyTonic);

  useEffect(() => {
    if (!editing) setDraft(symbol);
  }, [editing, symbol]);

  useEffect(() => {
    if (rootOnly) {
      setInstrumentView("bass");
      return;
    }
    const source = sourceLabel.toLowerCase();
    if (source.includes("guitar")) setInstrumentView("guitar");
    else if (source.includes("bass")) setInstrumentView("bass");
    else if (source.includes("piano") || source.includes("keys")) setInstrumentView("piano");
  }, [rootOnly, sourceLabel]);

  useEffect(() => {
    if (!rootOnly) return;
    setEditing(false);
    setEditTarget(null);
  }, [rootOnly]);

  useEffect(() => {
    if (rootOnly) return;
    if (editRequested === undefined) return;
    if (handledRequest.current === editRequested) return;
    handledRequest.current = editRequested;
    setDraft(symbol);
    setEditTarget(segment);
    setEditing(true);
  }, [editRequested, rootOnly, segment, symbol]);

  const save = () => {
    const next = normalizedDraft;
    if (!validDraft || !next) return;
    if (editTarget) onChangeChord(next, editTarget);
    setEditing(false);
    setEditTarget(null);
  };

  return (
    <section className="grid min-h-[26rem] flex-1 grid-cols-1 border-t border-separator lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-[22rem] min-w-0 flex-col overflow-x-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-[32rem] items-center justify-between gap-4 text-mini text-tertiary">
          <div>
            <span className="font-semibold uppercase tracking-[0.14em]">
              {rootOnly ? "Detected root" : "Playable voicing"}
            </span>
            <span className="ml-2 text-quaternary">
              {rootOnly ? "Interactive root-note map" : "Interactive instrument map"}
            </span>
          </div>
          <div className="flex rounded-md border border-separator bg-well p-0.5" role="group" aria-label="Instrument view">
            {(["piano", "guitar", "bass"] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={instrumentView === view}
                onClick={() => setInstrumentView(view)}
                className={`min-h-7 rounded px-2.5 text-[10px] font-semibold capitalize transition-colors ${
                  instrumentView === view ? "bg-control text-primary" : "text-tertiary hover:text-secondary"
                }`}
              >
                {view === "piano" ? "Keys" : view}
              </button>
            ))}
          </div>
          <span className="rounded-full border border-separator bg-control-subtle px-2.5 py-1">
            {rootOnly ? "Roots" : "Chords"} from <strong className="text-secondary">{sourceLabel}</strong>
          </span>
        </div>

        <div className="flex min-h-[18rem] min-w-[32rem] flex-1 items-center justify-center py-6">
          {instrumentView === "piano" ? (
            <Piano2D notes={chordNotes.notes} rootPc={chordNotes.rootPc} className="mx-auto max-w-5xl" />
          ) : instrumentView === "guitar" ? (
            <GuitarFretboard notes={chordNotes.notes} rootPc={chordNotes.rootPc} className="w-full max-w-6xl" />
          ) : (
            <BassFretboard notes={chordNotes.notes} rootPc={chordNotes.rootPc} rootOnly={rootOnly} className="w-full max-w-6xl" />
          )}
        </div>

        <div
          className="grid min-w-[32rem] grid-cols-3 gap-2"
          aria-label={rootOnly ? "Detected root sequence" : "Chord progression context"}
        >
          <ProgressionCell label={rootOnly ? "Previous root" : "Previous"} segment={previousSegment} keyTonic={keyTonic} />
          <ProgressionCell label={rootOnly ? "Current root" : "Now"} segment={segment} keyTonic={keyTonic} active />
          <ProgressionCell label={rootOnly ? "Next root" : "Next"} segment={nextSegment} keyTonic={keyTonic} />
        </div>
      </div>

      <aside className="surface-highlight flex flex-col border-t border-separator p-4 lg:border-l lg:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.15em] text-tertiary">
              {rootOnly ? "Root at the playhead" : "At the playhead"}
            </p>
            <p className="data-value mt-1 text-4xl font-semibold tracking-[-0.055em] text-primary">{symbol}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-md border border-accent/35 bg-accent/10 px-2 py-1 text-sm font-bold text-accent">
                {harmonicFunction.degree}
              </span>
              <span className="text-sm font-semibold text-secondary">{harmonicFunction.solfa}</span>
              <span className="text-mini text-tertiary">in {keyTonic}</span>
            </div>
          </div>
          {segment && !rootOnly ? (
            <button
              type="button"
              onClick={() => {
                setDraft(symbol);
                setEditTarget(segment);
                setEditing(true);
              }}
              className="transport-icon"
              aria-label="Correct detected chord"
              title="Correct detected chord"
            >
              <PencilIcon />
            </button>
          ) : null}
        </div>

        {!rootOnly && capo > 0 && symbol !== NO_CHORD ? (
          <div className="mt-3 rounded-md border border-accent/25 bg-accent/10 px-3 py-2">
            <span className="text-mini text-tertiary">Capo {capo} · chord symbol</span>
            <strong className="ml-2 text-sm text-accent">{shape}</strong>
          </div>
        ) : null}

        {!rootOnly && editing ? (
          <div className="mt-4">
            <label htmlFor="chord-correction" className="text-mini-strong text-secondary">Chord symbol</label>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                id="chord-correction"
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") save();
                  if (event.key === "Escape") {
                    setEditing(false);
                    setEditTarget(null);
                  }
                }}
                autoFocus
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-separator bg-well px-2.5 py-2 text-sm text-primary outline-none transition focus:border-accent"
                placeholder="Cmaj7"
                aria-invalid={!validDraft}
              />
              <button type="button" onClick={save} disabled={!validDraft} className="transport-icon bg-accent text-accent-contrast" aria-label="Save chord">
                <CheckIcon />
              </button>
              <button type="button" onClick={() => { setEditing(false); setEditTarget(null); }} className="transport-icon" aria-label="Cancel chord edit">
                <XIcon />
              </button>
            </div>
            {!validDraft ? <p className="mt-1.5 text-mini text-red-300">Use a chord such as C, F#m7, or Bbmaj7.</p> : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-1.5">
          {chordNotes.notes.length ? chordNotes.notes.map((note, index) => (
            <span
              key={`${note.pc}-${index}`}
              className="rounded border border-separator bg-well px-2 py-1 text-xs font-semibold text-secondary first:border-accent/40 first:text-accent"
            >
              {note.name.replace("#", "♯").replace("b", "♭")}
            </span>
          )) : (
            <span className="text-small text-tertiary">
              {rootOnly ? "No bass root detected here." : "No harmonic content detected here."}
            </span>
          )}
        </div>

        {segment ? (
          <dl className="mt-auto grid grid-cols-2 gap-3 pt-6 text-mini">
            <div>
              <dt className="text-tertiary">Range</dt>
              <dd className="mt-0.5 font-mono text-secondary">{formatTime(segment.startSec)}–{formatTime(segment.endSec)}</dd>
            </div>
            <div>
              <dt className="text-tertiary">{segment.edited ? "Source" : "Confidence"}</dt>
              <dd className="mt-0.5 font-mono text-secondary">
                {segment.edited ? "Manual edit" : `${Math.round(segment.confidence * 100)}%`}
              </dd>
            </div>
          </dl>
        ) : null}
      </aside>
    </section>
  );
}
