import { FretboardCore, type FretboardProps } from "./fretboard-core";

const GUITAR_STRINGS = [
  { label: "high E", openMidi: 64 },
  { label: "B", openMidi: 59 },
  { label: "G", openMidi: 55 },
  { label: "D", openMidi: 50 },
  { label: "A", openMidi: 45 },
  { label: "low E", openMidi: 40 },
] as const;

export type GuitarFretboardProps = FretboardProps;

/** Interactive standard-tuned guitar neck showing every current chord tone. */
export function GuitarFretboard(props: GuitarFretboardProps) {
  return (
    <FretboardCore
      {...props}
      title="Guitar chord map"
      subtitle="Standard tuning · E A D G B E · frets 0–12"
      strings={GUITAR_STRINGS}
    />
  );
}
