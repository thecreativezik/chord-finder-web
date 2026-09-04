import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "../cn";
import { usePianoSynth } from "../keyboard/use-piano-synth";

const CHROMATIC_SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const LAST_FRET = 12;
const LANDMARK_FRETS = new Set([3, 5, 7, 9, 12]);

export interface FretboardNote {
  name: string;
  pc: number;
}

export interface FretboardString {
  /** Accessible string name, for example "low E" or "G". */
  label: string;
  /** MIDI note of the open string. */
  openMidi: number;
}

export interface FretboardProps {
  notes: readonly FretboardNote[];
  rootPc: number | null;
  className?: string;
  /** The source contains a detected monophonic root, not an inferred chord. */
  rootOnly?: boolean;
}

interface FretboardCoreProps extends FretboardProps {
  title: string;
  subtitle: string;
  strings: readonly FretboardString[];
  rootFocused?: boolean;
}

function normalizePc(pc: number): number {
  return ((Math.round(pc) % 12) + 12) % 12;
}

function spokenNoteName(name: string): string {
  return name.replace(/#/g, " sharp").replace(/b/g, " flat");
}

function displayNoteName(name: string): string {
  return name.replace(/#/g, "♯").replace(/b/g, "♭");
}

function noteNameAtMidi(midi: number, spellings: ReadonlyMap<number, FretboardNote>): string {
  const pc = normalizePc(midi);
  const pitch = spellings.get(pc)?.name ?? CHROMATIC_SHARPS[pc];
  return `${pitch}${Math.floor(midi / 12) - 1}`;
}

function landmark(fret: number): string {
  if (!LANDMARK_FRETS.has(fret)) return "";
  return fret === 12 ? "••" : "•";
}

export function FretboardCore({
  notes,
  rootPc,
  className,
  title,
  subtitle,
  strings,
  rootFocused = false,
  rootOnly = false,
}: FretboardCoreProps) {
  const { noteOn, noteOff, allNotesOff } = usePianoSynth();
  const [pressedPositions, setPressedPositions] = useState<ReadonlySet<string>>(() => new Set());
  const activePositions = useRef(new Map<string, number>());

  const noteByPc = useMemo(() => {
    const next = new Map<number, FretboardNote>();
    for (const note of notes) {
      const pc = normalizePc(note.pc);
      if (!next.has(pc)) next.set(pc, { ...note, pc });
    }
    return next;
  }, [notes]);
  const normalizedRootPc = rootPc === null ? null : normalizePc(rootPc);
  const rootName = normalizedRootPc === null
    ? null
    : (noteByPc.get(normalizedRootPc)?.name ?? CHROMATIC_SHARPS[normalizedRootPc]);

  const startPosition = useCallback((positionId: string, midi: number) => {
    if (activePositions.current.has(positionId)) return;
    activePositions.current.set(positionId, midi);
    setPressedPositions((current) => new Set(current).add(positionId));
    noteOn(midi, positionId);
  }, [noteOn]);

  const stopPosition = useCallback((positionId: string) => {
    const midi = activePositions.current.get(positionId);
    if (midi === undefined) return;
    activePositions.current.delete(positionId);
    setPressedPositions((current) => {
      const next = new Set(current);
      next.delete(positionId);
      return next;
    });
    noteOff(midi, positionId);
  }, [noteOff]);

  useEffect(() => () => {
    activePositions.current.clear();
    allNotesOff();
  }, [allNotesOff]);

  const handlePointerDown = (
    positionId: string,
    midi: number,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startPosition(positionId, midi);
  };

  const handleKeyDown = (
    positionId: string,
    midi: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    startPosition(positionId, midi);
  };

  const handleKeyUp = (positionId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    stopPosition(positionId);
  };

  const chordNames = notes.map((note) => spokenNoteName(note.name));
  const groupLabel = chordNames.length
    ? rootOnly
      ? `${title}. Detected root ${rootName ? spokenNoteName(rootName) : "not available"}.`
      : `${title}. Root ${rootName ? spokenNoteName(rootName) : "not available"}. Chord tones ${chordNames.join(", ")}.`
    : rootOnly
      ? `${title}. No bass root at the playhead.`
      : `${title}. No chord tones at the playhead.`;

  return (
    <section className={cn("min-w-0", className)} aria-label={groupLabel}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-small-strong text-secondary">{title}</h3>
          <p className="mt-0.5 text-mini text-tertiary">{subtitle}</p>
        </div>
        {rootFocused && rootName ? (
          <span className="rounded-md border border-accent/35 bg-accent/10 px-2.5 py-1 text-mini-strong text-accent">
            Root · {displayNoteName(rootName)}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-separator bg-well" data-scroll-lane>
        <div
          className="grid min-w-[47rem] select-none overflow-hidden"
          role="group"
          aria-label={`${title} interactive neck`}
          style={{ gridTemplateColumns: `3.25rem repeat(${LAST_FRET + 1}, minmax(2.75rem, 1fr))` }}
        >
          <div className="border-b border-r border-separator bg-control-subtle" aria-hidden="true" />
          {Array.from({ length: LAST_FRET + 1 }, (_, fret) => (
            <div
              key={`fret-label-${fret}`}
              className={cn(
                "relative flex h-8 items-center justify-center border-b border-r border-separator bg-control-subtle text-[9px] font-semibold tabular-nums text-tertiary last:border-r-0",
                fret === 0 && "border-r-2 border-r-secondary/45",
              )}
              aria-hidden="true"
            >
              <span>{fret === 0 ? "OPEN" : fret}</span>
              {landmark(fret) ? (
                <span className="absolute bottom-0.5 leading-none text-quaternary">{landmark(fret)}</span>
              ) : null}
            </div>
          ))}

          {strings.map((string, stringIndex) => (
            <Fragment key={`${string.label}-${string.openMidi}`}>
              <div
                className="flex h-11 items-center justify-center border-b border-r border-separator bg-control-subtle px-1 text-[10px] font-semibold text-tertiary last:border-b-0"
                aria-hidden="true"
              >
                {string.label}
              </div>
              {Array.from({ length: LAST_FRET + 1 }, (_, fret) => {
                const midi = string.openMidi + fret;
                const pc = normalizePc(midi);
                const chordNote = noteByPc.get(pc);
                const isRoot = normalizedRootPc === pc;
                const isChordTone = Boolean(chordNote);
                const positionId = `${stringIndex}-${fret}`;
                const isPressed = pressedPositions.has(positionId);
                const noteName = noteNameAtMidi(midi, noteByPc);
                const fretDescription = fret === 0 ? "open string" : `fret ${fret}`;
                const toneDescription = isRoot
                  ? rootOnly ? ", detected root" : ", chord root"
                  : isChordTone ? ", chord tone" : "";

                return (
                  <button
                    type="button"
                    key={positionId}
                    className={cn(
                      "group relative flex h-11 touch-none items-center justify-center border-b border-r border-separator/80 bg-[#121514] focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px] last:border-r-0",
                      fret === 0 && "border-r-2 border-r-secondary/45 bg-control-subtle",
                      stringIndex === strings.length - 1 && "border-b-0",
                      isPressed && "bg-accent/10",
                    )}
                    aria-label={`Play ${spokenNoteName(noteName)} on ${string.label} string, ${fretDescription}${toneDescription}`}
                    aria-pressed={isPressed}
                    title={`${displayNoteName(noteName)} · ${string.label} string · ${fretDescription}`}
                    onPointerDown={(event) => handlePointerDown(positionId, midi, event)}
                    onPointerUp={() => stopPosition(positionId)}
                    onPointerCancel={() => stopPosition(positionId)}
                    onLostPointerCapture={() => stopPosition(positionId)}
                    onKeyDown={(event) => handleKeyDown(positionId, midi, event)}
                    onKeyUp={(event) => handleKeyUp(positionId, event)}
                    onBlur={() => stopPosition(positionId)}
                  >
                    <span
                      className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 bg-secondary/55"
                      style={{ height: `${0.8 + stringIndex * 0.32}px` }}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "pointer-events-none relative z-10 flex size-6 items-center justify-center rounded-full border text-[9px] font-bold transition-[opacity,transform,background-color]",
                        isRoot && "border-accent bg-accent text-accent-contrast shadow-[0_0_0_3px_rgb(226_173_105_/_0.12)]",
                        isChordTone && !isRoot && "border-accent/80 bg-background text-primary",
                        !isChordTone && "border-separator bg-control text-tertiary opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                        isPressed && "scale-110 opacity-100",
                        rootFocused && isChordTone && !isRoot && "opacity-70",
                      )}
                      aria-hidden="true"
                    >
                      {isChordTone || isPressed ? displayNoteName(noteName).replace(/[0-9-]/g, "") : ""}
                    </span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-mini text-tertiary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3.5 rounded-full border-2 border-accent bg-accent" />
          Root note
        </span>
        {!rootOnly ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3.5 rounded-full border-2 border-accent bg-background" />
            Chord tone
          </span>
        ) : null}
        <span>Press any position to hear it</span>
      </div>
    </section>
  );
}
