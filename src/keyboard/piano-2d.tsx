// Flat, chart-style piano keyboard — like a printed chord diagram.
//
// Two octaves of keys drawn with plain divs. The active chord's notes are
// marked with labeled dots: a solid accent dot for the root, outlined dots for
// the other chord tones. The piano itself keeps fixed white/dark key colors
// (it depicts a physical object; theme tokens are used for everything else).

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "../cn";
import { usePianoSynth } from "./use-piano-synth";

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const WHITE_LABELS = ["C", "D", "E", "F", "G", "A", "B"];
// Black key pitch class -> index of the white key it sits after (within octave).
const BLACK_AFTER_WHITE: Record<number, number> = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
const OCTAVES = 3;
// Chord voicings are anchored in the middle octave so the root stays in the
// same place from chord to chord; wide chords (9ths) spill into the right
// octave and the left octave gives visual context.
const ROOT_OCTAVE = 1;
const WHITE_COUNT = OCTAVES * 7;
const WHITE_W = 100 / WHITE_COUNT; // percent
const BLACK_W = WHITE_W * 0.62;

export interface PianoNote {
  name: string; // display name from tonal, e.g. "Bb"
  pc: number; // pitch class 0..11, C = 0
}

interface PlacedNote extends PianoNote {
  octave: number; // 0 or 1 within the displayed range
  isRoot: boolean;
}

interface Piano2DProps {
  notes: PianoNote[]; // in ascending chord-factor order (root first)
  rootPc: number | null;
  className?: string;
}

/**
 * Assign each chord tone to a display octave so the voicing reads left to
 * right in ascending order (e.g. C9 -> C E G Bb in octave 0, D in octave 1).
 */
function placeNotes(notes: PianoNote[], rootPc: number | null): PlacedNote[] {
  const placed: PlacedNote[] = [];
  let octave = ROOT_OCTAVE;
  let prevPc = -1;
  for (const note of notes) {
    if (placed.length > 0 && note.pc <= prevPc) octave = Math.min(octave + 1, OCTAVES - 1);
    placed.push({ ...note, octave, isRoot: note.pc === rootPc && placed.length === 0 });
    prevPc = note.pc;
  }
  return placed;
}

/** Horizontal center of a key, as a percentage of the keyboard width. */
function keyCenter(pc: number, octave: number): number {
  const whiteIndex = WHITE_PCS.indexOf(pc);
  if (whiteIndex >= 0) {
    return (octave * 7 + whiteIndex + 0.5) * WHITE_W;
  }
  return (octave * 7 + BLACK_AFTER_WHITE[pc] + 1) * WHITE_W;
}

function NoteDot({ note }: { note: PlacedNote }) {
  const onBlackKey = !WHITE_PCS.includes(note.pc);
  return (
    <div
      className={cn(
        "pointer-events-none absolute z-20 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-accent text-mini-strong",
        note.isRoot ? "bg-accent text-accent-contrast" : "bg-background text-foreground",
      )}
      style={{
        left: `${keyCenter(note.pc, note.octave)}%`,
        // Black keys are shorter, so their dots sit higher up.
        ...(onBlackKey ? { top: "40%" } : { bottom: "17%" }),
      }}
    >
      {note.name.replace("#", "♯").replace("b", "♭")}
    </div>
  );
}

export function Piano2D({ notes, rootPc, className }: Piano2DProps) {
  const placed = placeNotes(notes, rootPc);
  const synth = usePianoSynth();
  const activePresses = useRef(new Map<string, number>());
  const [pressedMidis, setPressedMidis] = useState<ReadonlySet<number>>(() => new Set());
  const noteNames = notes.map((note) => note.name.replace("#", "sharp ").replace("b", "flat "));
  const pianoLabel = noteNames.length
    ? `Piano diagram. Root ${noteNames[0]}. Chord notes ${noteNames.join(", ")}.`
    : "Piano diagram. No chord notes at the playhead.";

  const syncPressedMidis = () => {
    setPressedMidis(new Set(activePresses.current.values()));
  };

  const startNote = (pressId: string, midi: number) => {
    if (activePresses.current.has(pressId)) return;
    activePresses.current.set(pressId, midi);
    syncPressedMidis();
    synth.noteOn(midi, pressId);
  };

  const stopNote = (pressId: string) => {
    const midi = activePresses.current.get(pressId);
    if (midi === undefined) return;
    activePresses.current.delete(pressId);
    syncPressedMidis();
    synth.noteOff(midi, pressId);
  };

  const onPointerDown = (midi: number, event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startNote(`pointer:${event.pointerId}`, midi);
  };

  const onPointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    stopNote(`pointer:${event.pointerId}`);
  };

  const onKeyDown = (midi: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    startNote(`keyboard:${midi}`, midi);
  };

  const onKeyUp = (midi: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    stopNote(`keyboard:${midi}`);
  };

  return (
    <div
      data-piano
      role="group"
      aria-label={pianoLabel}
      className={cn("flex w-full flex-col items-center gap-3", className)}
    >
      <div className="relative aspect-[7/2] w-full max-w-4xl select-none">
        {/* White keys */}
        {Array.from({ length: WHITE_COUNT }, (_, i) => {
          const octave = Math.floor(i / 7);
          const pc = WHITE_PCS[i % 7];
          const midi = 48 + octave * 12 + pc;
          const label = `${WHITE_LABELS[i % 7]}${octave + 3}`;
          return (
            <button
              type="button"
              key={`w${i}`}
              className={cn(
                "absolute top-0 h-full touch-none rounded-b-md border border-neutral-300 bg-white transition-[background-color,transform] focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-accent",
                pressedMidis.has(midi) && "bg-amber-100 [transform:translateY(2px)]",
              )}
              style={{ left: `${i * WHITE_W}%`, width: `${WHITE_W}%` }}
              aria-label={`Play ${label}`}
              aria-pressed={pressedMidis.has(midi)}
              onPointerDown={(event) => onPointerDown(midi, event)}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onLostPointerCapture={onPointerEnd}
              onKeyDown={(event) => onKeyDown(midi, event)}
              onKeyUp={(event) => onKeyUp(midi, event)}
              onBlur={() => stopNote(`keyboard:${midi}`)}
            >
              <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-mini text-neutral-400">
                {WHITE_LABELS[i % 7]}
              </span>
            </button>
          );
        })}
        {/* Black keys */}
        {Array.from({ length: OCTAVES }, (_, oct) =>
          Object.entries(BLACK_AFTER_WHITE).map(([pcString, after]) => {
            const pc = Number(pcString);
            const midi = 48 + oct * 12 + pc;
            const sharpName = ["", "C♯", "", "D♯", "", "", "F♯", "", "G♯", "", "A♯"][pc];
            return (
              <button
                type="button"
                key={`b${oct}-${pc}`}
                className={cn(
                  "absolute top-0 z-10 h-[62%] touch-none rounded-b-md border border-neutral-950 bg-neutral-800 transition-[background-color,transform] focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-accent",
                  pressedMidis.has(midi) && "bg-neutral-600 [transform:translateY(2px)]",
                )}
                style={{
                  left: `${(oct * 7 + after + 1) * WHITE_W - BLACK_W / 2}%`,
                  width: `${BLACK_W}%`,
                }}
                aria-label={`Play ${sharpName}${oct + 3}`}
                aria-pressed={pressedMidis.has(midi)}
                onPointerDown={(event) => onPointerDown(midi, event)}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onLostPointerCapture={onPointerEnd}
                onKeyDown={(event) => onKeyDown(midi, event)}
                onKeyUp={(event) => onKeyUp(midi, event)}
                onBlur={() => stopNote(`keyboard:${midi}`)}
              />
            );
          }),
        )}
        {/* Chord dots */}
        {placed.map((note, i) => (
          <NoteDot key={`${note.pc}-${note.octave}-${i}`} note={note} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-1.5 text-mini text-tertiary">
          <span className="inline-block size-3.5 rounded-full border-2 border-accent bg-accent" />
          Root note
        </span>
        <span className="flex items-center gap-1.5 text-mini text-tertiary">
          <span className="inline-block size-3.5 rounded-full border-2 border-accent bg-background" />
          Chord note
        </span>
        <span className="hidden text-mini text-tertiary sm:inline">Click any key to hear it</span>
      </div>
    </div>
  );
}
