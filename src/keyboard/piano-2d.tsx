// Flat, chart-style piano keyboard — like a printed chord diagram.
//
// Two octaves of keys drawn with plain divs. The active chord's notes are
// marked with labeled dots: a solid accent dot for the root, outlined dots for
// the other chord tones. The piano itself keeps fixed white/dark key colors
// (it depicts a physical object; theme tokens are used for everything else).

import { cn } from "../cn";

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
        "pointer-events-none absolute flex size-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-accent text-mini-strong",
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

  return (
    <div className={cn("flex w-full flex-col items-center gap-3", className)}>
      <div className="relative aspect-[7/2] w-full max-w-4xl select-none">
        {/* White keys */}
        {Array.from({ length: WHITE_COUNT }, (_, i) => (
          <div
            key={`w${i}`}
            className="absolute top-0 h-full rounded-b-md border border-neutral-300 bg-white"
            style={{ left: `${i * WHITE_W}%`, width: `${WHITE_W}%` }}
          >
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-mini text-neutral-400">
              {WHITE_LABELS[i % 7]}
            </span>
          </div>
        ))}
        {/* Black keys */}
        {Array.from({ length: OCTAVES }, (_, oct) =>
          Object.entries(BLACK_AFTER_WHITE).map(([pc, after]) => (
            <div
              key={`b${oct}-${pc}`}
              className="absolute top-0 h-[62%] rounded-b-md bg-neutral-800"
              style={{
                left: `${(oct * 7 + after + 1) * WHITE_W - BLACK_W / 2}%`,
                width: `${BLACK_W}%`,
              }}
            />
          )),
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
      </div>
    </div>
  );
}
