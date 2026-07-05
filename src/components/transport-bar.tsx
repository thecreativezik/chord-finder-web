// Audio transport: play/pause + seek scrubber bound to the <audio> element.

import { PauseIcon, PlayIcon } from "lucide-react";

import { formatTime, type Playback } from "./use-playback";

interface TransportBarProps {
  playback: Playback;
}

export function TransportBar({ playback }: TransportBarProps) {
  const { isPlaying, currentTime, duration, toggle, seek } = playback;
  const max = Math.max(duration, 0.001);

  return (
    <div className="flex items-center gap-3 border-t border-separator px-4 py-3">
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast transition-opacity hover:opacity-90 [&_svg]:size-4"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>
      <span className="w-10 text-right text-small text-secondary tabular-nums">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        className="scrubber flex-1"
        value={Math.min(currentTime, max)}
        min={0}
        max={max}
        step={0.01}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label="Seek"
      />
      <span className="w-10 text-small text-secondary tabular-nums">{formatTime(duration)}</span>
    </div>
  );
}
