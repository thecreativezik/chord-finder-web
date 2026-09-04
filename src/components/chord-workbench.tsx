import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import { getChordNotes, transposeChordSymbol } from "../analysis/chord-notes";
import { NO_CHORD } from "../analysis/classify-chords";
import { Piano2D } from "../keyboard/piano-2d";
import type { ChordSegment } from "../types";
import { formatTime } from "./use-playback";

interface ChordWorkbenchProps {
  segment: ChordSegment | null;
  capo: number;
  onChangeChord: (symbol: string, segment: ChordSegment) => void;
  editRequested?: number;
}

function normalizeChordSymbol(symbol: string): string {
  return symbol.trim().replace(/♯/g, "#").replace(/♭/g, "b");
}

export function ChordWorkbench({ segment, capo, onChangeChord, editRequested }: ChordWorkbenchProps) {
  const symbol = segment?.symbol ?? NO_CHORD;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(symbol);
  const [editTarget, setEditTarget] = useState<ChordSegment | null>(null);
  const handledRequest = useRef<number | undefined>(undefined);
  const chordNotes = useMemo(() => getChordNotes(symbol), [symbol]);
  const normalizedDraft = normalizeChordSymbol(draft);
  const draftNotes = useMemo(() => getChordNotes(normalizedDraft), [normalizedDraft]);
  const validDraft = normalizedDraft === NO_CHORD || draftNotes.notes.length > 0;
  const shape = capo > 0 ? transposeChordSymbol(symbol, -capo) : symbol;

  useEffect(() => {
    if (!editing) setDraft(symbol);
  }, [editing, symbol]);

  useEffect(() => {
    if (editRequested === undefined) return;
    if (handledRequest.current === editRequested) return;
    handledRequest.current = editRequested;
    setDraft(symbol);
    setEditTarget(segment);
    setEditing(true);
  }, [editRequested, segment, symbol]);

  const save = () => {
    const next = normalizedDraft;
    if (!validDraft || !next) return;
    if (editTarget) onChangeChord(next, editTarget);
    setEditing(false);
    setEditTarget(null);
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 border-t border-separator lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-h-[15rem] min-w-0 overflow-x-auto px-4 py-5 sm:px-6 lg:px-10">
        <Piano2D notes={chordNotes.notes} rootPc={chordNotes.rootPc} className="mx-auto min-w-[32rem] max-w-5xl" />
      </div>

      <aside className="surface-highlight flex flex-col border-t border-separator p-4 lg:border-l lg:border-t-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.15em] text-tertiary">At the playhead</p>
            <p className="data-value mt-1 text-4xl font-semibold tracking-[-0.055em] text-primary">{symbol}</p>
          </div>
          {segment ? (
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

        {capo > 0 && symbol !== NO_CHORD ? (
          <div className="mt-3 rounded-md border border-accent/25 bg-accent/10 px-3 py-2">
            <span className="text-mini text-tertiary">Capo {capo} · chord symbol</span>
            <strong className="ml-2 text-sm text-accent">{shape}</strong>
          </div>
        ) : null}

        {editing ? (
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

        <div className="mt-4 flex flex-wrap gap-1.5">
          {chordNotes.notes.length ? chordNotes.notes.map((note, index) => (
            <span
              key={`${note.pc}-${index}`}
              className="rounded border border-separator bg-well px-2 py-1 text-xs font-semibold text-secondary first:border-accent/40 first:text-accent"
            >
              {note.name.replace("#", "♯").replace("b", "♭")}
            </span>
          )) : <span className="text-small text-tertiary">No harmonic content detected here.</span>}
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
