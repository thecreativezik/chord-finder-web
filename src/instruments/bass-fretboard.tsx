import { FretboardCore, type FretboardProps } from "./fretboard-core";

const BASS_STRINGS = [
  { label: "G", openMidi: 43 },
  { label: "D", openMidi: 38 },
  { label: "A", openMidi: 33 },
  { label: "E", openMidi: 28 },
] as const;

export type BassFretboardProps = FretboardProps;

/** Interactive standard-tuned bass neck with the harmonic root emphasized. */
export function BassFretboard(props: BassFretboardProps) {
  return (
    <FretboardCore
      {...props}
      title="Bass root map"
      subtitle="Standard tuning · E A D G · frets 0–12"
      strings={BASS_STRINGS}
      rootFocused
    />
  );
}
