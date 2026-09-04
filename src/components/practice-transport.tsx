import {
  FastForwardIcon,
  GaugeIcon,
  Music2Icon,
  PauseIcon,
  PlayIcon,
  Repeat2Icon,
  RewindIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";

import { cn } from "../cn";
import type { Metronome, MetronomeDensity } from "./use-metronome";
import { formatTime, type Playback } from "./use-playback";

interface PracticeTransportProps {
  playback: Playback;
  metronome: Metronome;
  capo: number;
  onCapoChange: (fret: number) => void;
}

const SPEEDS = [0.5, 0.65, 0.75, 0.85, 1, 1.1, 1.25, 1.5];
const DENSITIES: MetronomeDensity[] = [0.5, 1, 2];

function ToolLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-tertiary">{children}</span>;
}

export function PracticeTransport({
  playback,
  metronome,
  capo,
  onCapoChange,
}: PracticeTransportProps) {
  const max = Math.max(playback.duration, 0.001);
  const loopReady = playback.loopStart !== null && playback.loopEnd !== null;

  return (
    <footer
      data-practice-transport
      className="relative shrink-0 border-t border-separator bg-background/95 px-3 py-2.5 backdrop-blur-xl sm:px-4"
    >
      <div className="mx-auto flex max-w-[1500px] flex-col gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => playback.skip(-5)}
            className="transport-icon"
            aria-label="Rewind 5 seconds"
            title="Rewind 5 seconds (←)"
          >
            <RewindIcon />
          </button>
          <button
            type="button"
            onClick={playback.toggle}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-[0_8px_24px_color-mix(in_oklab,var(--cf-accent)_28%,transparent)] transition hover:brightness-110 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-[1.05rem]"
            aria-label={playback.isPlaying ? "Pause" : "Play"}
            title="Play or pause (Space)"
          >
            {playback.isPlaying ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
          </button>
          <button
            type="button"
            onClick={() => playback.skip(5)}
            className="transport-icon"
            aria-label="Forward 5 seconds"
            title="Forward 5 seconds (→)"
          >
            <FastForwardIcon />
          </button>

          <span className="hidden w-[4.35rem] text-right font-mono text-xs tabular-nums text-secondary sm:inline">
            {formatTime(playback.currentTime)}
          </span>
          <input
            type="range"
            className="scrubber min-w-16 flex-1"
            value={Math.min(playback.currentTime, max)}
            min={0}
            max={max}
            step={0.01}
            onChange={(event) => playback.seek(Number(event.target.value))}
            aria-label="Seek through song"
          />
          <span className="hidden w-[4.35rem] font-mono text-xs tabular-nums text-secondary sm:inline">
            {formatTime(playback.duration)}
          </span>

          <label className="flex shrink-0 items-center gap-1.5 rounded-md border border-separator bg-control-subtle px-2 py-1.5">
            <GaugeIcon className="size-3.5 text-tertiary" />
            <span className="sr-only">Playback speed</span>
            <select
              value={playback.playbackRate}
              onChange={(event) => playback.setPlaybackRate(Number(event.target.value))}
              className="bg-transparent text-xs font-semibold tabular-nums text-primary outline-none"
            >
              {SPEEDS.map((speed) => (
                <option key={speed} value={speed}>{speed}×</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5">
          <ToolLabel>Practice</ToolLabel>
          <button
            type="button"
            onClick={metronome.toggle}
            className={cn("tool-button", metronome.enabled && "tool-button-active")}
            aria-pressed={metronome.enabled}
          >
            <Music2Icon />
            Click
          </button>
          <fieldset className="flex rounded-md border border-separator bg-control-subtle p-0.5">
            <legend className="sr-only">Metronome density</legend>
            {DENSITIES.map((density) => (
              <label
                key={density}
                className={cn(
                  "relative flex min-h-7 cursor-pointer items-center rounded px-2 py-1 text-[0.6875rem] font-semibold tabular-nums text-tertiary transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent",
                  metronome.density === density && "bg-control text-primary",
                )}
              >
                <input
                  type="radio"
                  name="metronome-density"
                  value={density}
                  checked={metronome.density === density}
                  onChange={() => metronome.setDensity(density)}
                  className="sr-only"
                />
                <span>{density}×</span>
              </label>
            ))}
          </fieldset>
          <label className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-separator bg-control-subtle px-2" title="Click volume">
            <Volume2Icon className="size-3.5 text-tertiary" aria-hidden="true" />
            <span className="sr-only">Click volume</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={metronome.volume}
              onChange={(event) => metronome.setVolume(Number(event.target.value))}
              className="h-1 w-20 cursor-pointer accent-current sm:w-24"
              aria-valuetext={`${Math.round(metronome.volume * 100)} percent`}
            />
            <output className="w-7 text-right text-[9px] tabular-nums text-tertiary" aria-hidden="true">
              {Math.round(metronome.volume * 100)}
            </output>
          </label>

          <span className="mx-1 h-5 w-px shrink-0 bg-separator" />
          <Repeat2Icon className={cn("size-3.5 shrink-0", loopReady ? "text-accent" : "text-tertiary")} />
          <button
            type="button"
            onClick={() => playback.setLoopStart(playback.currentTime)}
            className={cn("tool-button tabular-nums", playback.loopStart !== null && "tool-button-active")}
            title="Set loop start at the playhead"
          >
            A {playback.loopStart === null ? "Set" : formatTime(playback.loopStart)}
          </button>
          <button
            type="button"
            onClick={() => playback.setLoopEnd(playback.currentTime)}
            className={cn("tool-button tabular-nums", playback.loopEnd !== null && "tool-button-active")}
            title="Set loop end at the playhead"
          >
            B {playback.loopEnd === null ? "Set" : formatTime(playback.loopEnd)}
          </button>
          {playback.loopStart !== null || playback.loopEnd !== null ? (
            <button type="button" onClick={playback.clearLoop} className="transport-icon !size-7" aria-label="Clear loop">
              <XIcon />
            </button>
          ) : null}

          <span className="mx-1 h-5 w-px shrink-0 bg-separator" />
          <label className="tool-button cursor-pointer">
            <span className="font-serif text-sm leading-none">♯</span>
            Capo
            <select
              value={capo}
              onChange={(event) => onCapoChange(Number(event.target.value))}
              className="bg-transparent font-semibold text-primary outline-none"
              aria-label="Capo fret"
            >
              {Array.from({ length: 13 }, (_, fret) => (
                <option key={fret} value={fret}>{fret === 0 ? "Off" : fret}</option>
              ))}
            </select>
          </label>
          <span className="ml-auto hidden shrink-0 text-[0.6875rem] text-quaternary lg:inline">
            Space play · ←/→ skip · L loop · M click
          </span>
        </div>
      </div>
    </footer>
  );
}
