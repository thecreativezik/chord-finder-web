import { useRef, type ChangeEvent } from "react";
import {
  Layers3Icon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  Volume2Icon,
} from "lucide-react";

import { cn } from "../cn";
import {
  STEM_FILE_ACCEPT,
  STEM_KIND_LABEL,
  type StemMixerControls,
  type StemTrack,
} from "./use-stem-mixer";

export interface StemMixerProps extends StemMixerControls {
  className?: string;
}

function trackStatus(track: StemTrack): string {
  if (track.loadState === "error") return "Could not load audio";
  if (track.loadState === "loading") return "Loading";
  if (track.durationMismatch) return "Length differs from original mix";
  return STEM_KIND_LABEL[track.kind];
}

export function StemMixer({
  tracks,
  addFiles,
  removeTrack,
  updateTrack,
  toggleMute,
  toggleSolo,
  className,
}: StemMixerProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const importedCount = tracks.filter((track) => track.imported).length;
  const anySolo = tracks.some((track) => track.solo);

  const onFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) addFiles(event.target.files);
    // Allow selecting the same export again after it has been removed.
    event.target.value = "";
  };

  return (
    <section
      aria-label="Stem mixer"
      className={cn(
        "flex overflow-hidden rounded-lg border border-separator bg-control-subtle text-primary shadow-[0_14px_36px_rgb(0_0_0/0.18)]",
        className,
      )}
    >
      <div className="flex w-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-separator px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-control text-secondary">
            <Layers3Icon className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="whitespace-nowrap text-xs font-semibold tracking-wide text-primary">Stem mixer</h2>
            <p className="text-[10px] leading-3.5 text-tertiary">
              {importedCount === 0
                ? "Original mix only"
                : `${importedCount} imported ${importedCount === 1 ? "stem" : "stems"}`}
            </p>
          </div>
        </div>

        <input
          ref={pickerRef}
          type="file"
          accept={STEM_FILE_ACCEPT}
          multiple
          onChange={onFilesPicked}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-separator bg-control px-2.5 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:border-accent/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5"
          aria-label="Import stems"
          title="Import aligned stem files"
        >
          <UploadIcon aria-hidden="true" />
          Add
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-separator" aria-label="Mixer tracks">
          {tracks.map((track) => {
            const effectivelyMuted = track.muted || (anySolo && !track.solo);
            const status = trackStatus(track);
            const statusIsWarning = track.loadState === "error" || track.durationMismatch;

            return (
              <li
                key={track.id}
                className={cn(
                  "relative px-3 py-3 transition-opacity",
                  effectivelyMuted && "opacity-55",
                )}
              >
                <span
                  className="absolute inset-y-1.5 left-0 w-1 rounded-r-full"
                  style={{ backgroundColor: track.color }}
                  aria-hidden="true"
                />

                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium leading-4 text-primary" title={track.name}>
                      {track.name}
                    </p>
                    <p
                      className={cn(
                        "flex items-center gap-1 truncate text-[9px] uppercase leading-3 tracking-[0.12em] text-tertiary",
                        statusIsWarning && "text-amber-400",
                      )}
                      title={statusIsWarning ? status : undefined}
                    >
                      {statusIsWarning ? (
                        <TriangleAlertIcon className="size-2.5 shrink-0" aria-hidden="true" />
                      ) : null}
                      <span className="truncate">{status}</span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleMute(track.id)}
                    aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
                    aria-pressed={track.muted}
                    title={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
                    className={cn(
                      "flex size-9 items-center justify-center rounded border text-[9px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400 lg:size-7",
                      track.muted
                        ? "border-amber-400/50 bg-amber-400/20 text-amber-300"
                        : "border-separator bg-well text-tertiary hover:bg-control hover:text-primary",
                    )}
                  >
                    M
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSolo(track.id)}
                    aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`}
                    aria-pressed={track.solo}
                    title={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`}
                    className={cn(
                      "flex size-9 items-center justify-center rounded border text-[9px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent lg:size-7",
                      track.solo
                        ? "border-accent/50 bg-accent/15 text-accent"
                        : "border-separator bg-well text-tertiary hover:bg-control hover:text-primary",
                    )}
                  >
                    S
                  </button>

                  {track.imported ? (
                    <button
                      type="button"
                      onClick={() => removeTrack(track.id)}
                      aria-label={`Remove ${track.name}`}
                      title={`Remove ${track.name}`}
                      className="flex size-9 items-center justify-center rounded text-tertiary transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400 lg:size-7 [&_svg]:size-3.5"
                    >
                      <Trash2Icon aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                <label className="mt-2.5 flex min-w-0 items-center gap-1.5">
                  <span className="sr-only">{track.name} volume</span>
                  <Volume2Icon className="size-3 shrink-0 text-tertiary" aria-hidden="true" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={track.volume}
                    onChange={(event) =>
                      updateTrack(track.id, { volume: Number(event.target.value) })
                    }
                    aria-valuetext={`${Math.round(track.volume * 100)} percent`}
                    className="h-1 min-w-0 flex-1 cursor-pointer accent-current"
                    style={{ color: track.color }}
                  />
                  <span className="w-6 text-right text-[9px] tabular-nums text-tertiary" aria-hidden="true">
                    {Math.round(track.volume * 100)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {importedCount === 0 ? (
        <p className="hidden border-t border-separator px-3 py-2.5 text-[10px] leading-4 text-tertiary lg:block">
          Import matching vocal, drum, bass, guitar, or keys files. They will follow the song
          transport automatically.
        </p>
      ) : null}
      </div>
    </section>
  );
}
