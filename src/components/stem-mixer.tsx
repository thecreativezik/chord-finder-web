import { useId, useRef, type ChangeEvent } from "react";
import {
  DownloadIcon,
  Layers3Icon,
  LoaderCircleIcon,
  Music2Icon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  Volume2Icon,
} from "lucide-react";

import { describeProvenance } from "../analysis/provenance";
import { cn } from "../cn";
import type { ExportFormat, ExportStage } from "../audio/export-mix";
import type { SeparationStatus } from "../separation/use-separation";
import {
  STEM_FILE_ACCEPT,
  STEM_KIND_LABEL,
  type StemMixerControls,
  type StemTrack,
} from "./use-stem-mixer";

export type ChordSourceStatus =
  | { state: "idle" }
  | { state: "loading"; trackId: string; progress: number }
  | { state: "error"; trackId: string; message: string };

export type MixExportStatus =
  | { state: "idle" }
  | { state: "working"; stage: ExportStage; progress: number }
  | { state: "done" }
  | { state: "error"; message: string };

export interface StemMixerProps extends StemMixerControls {
  className?: string;
  chordSourceId: string;
  chordSourceStatus: ChordSourceStatus;
  onChordSourceChange: (trackId: string) => void;
  separationStatus: SeparationStatus;
  onSeparate: () => void;
  onCancelSeparation: () => void;
  exportFormat: ExportFormat;
  onExportFormatChange: (format: ExportFormat) => void;
  exportStatus: MixExportStatus;
  onExport: () => void;
}

function trackStatus(track: StemTrack): string {
  if (track.loadState === "error") return "Could not load audio";
  if (track.loadState === "loading") return "Loading";
  if (track.durationMismatch) return "Length differs from original mix";
  if (track.origin === "separated") return `${STEM_KIND_LABEL[track.kind]} · AI stem`;
  if (track.origin === "imported") return `${STEM_KIND_LABEL[track.kind]} · imported`;
  return STEM_KIND_LABEL[track.kind];
}

function unavailableChordSourceReason(track: StemTrack): string | null {
  if (track.kind === "drums") {
    return "Chord detection is unavailable for drums because a rhythm-only stem has no reliable harmonic root. Mute, solo, volume, and export still work.";
  }
  if (track.kind === "vocals") {
    return "Chord detection is unavailable for vocals because a melody alone does not contain the full harmony. Mute, solo, volume, and export still work.";
  }
  return null;
}

function separationCopy(status: SeparationStatus): string {
  if (status.state === "unsupported") return status.message;
  if (status.state === "working") return status.detail;
  if (status.state === "ready") return `${status.stemCount} aligned stems ready`;
  if (status.state === "cancelled") return "Separation cancelled";
  if (status.state === "error") return status.message;
  return "Downloads a 52 MB model once; audio stays on this device.";
}

const EXPORT_STAGE_LABEL: Record<ExportStage, string> = {
  decoding: "Decoding selected tracks",
  mixing: "Mixing selected tracks",
  transposing: "Applying the selected key",
  encoding: "Encoding download",
};

export function StemMixer({
  tracks,
  pitchEngineState,
  addFiles,
  removeTrack,
  updateTrack,
  toggleMute,
  toggleSolo,
  chordSourceId,
  chordSourceStatus,
  onChordSourceChange,
  separationStatus,
  onSeparate,
  onCancelSeparation,
  exportFormat,
  onExportFormatChange,
  exportStatus,
  onExport,
  className,
}: StemMixerProps) {
  const sourceGroupId = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const stemCount = tracks.filter((track) => track.origin !== "original").length;
  const hasSeparatedStems = tracks.some((track) => track.origin === "separated");
  const anySolo = tracks.some((track) => track.solo);
  const isSeparating = separationStatus.state === "working";
  const isExporting = exportStatus.state === "working";

  const onFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) addFiles(event.target.files);
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
                {stemCount === 0 ? "Original mix only" : `${stemCount} aligned ${stemCount === 1 ? "stem" : "stems"}`}
              </p>
            </div>
          </div>

          <input ref={pickerRef} type="file" accept={STEM_FILE_ACCEPT} multiple onChange={onFilesPicked} className="hidden" />
          <button
            type="button"
            onClick={() => pickerRef.current?.click()}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-separator bg-control px-2.5 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:border-accent/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&_svg]:size-3.5"
            aria-label="Import aligned stems"
            title="Import aligned stem files"
          >
            <UploadIcon aria-hidden="true" />
            Add
          </button>
        </div>

        <div className="border-b border-separator p-2.5">
          <div className="rounded-md border border-separator bg-well/70 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold text-secondary">Automatic instrument separation</p>
                <p className="mt-0.5 text-[9px] text-tertiary">Drums · bass · vocals · guitar · piano · other</p>
              </div>
              {isSeparating ? (
                <button type="button" onClick={onCancelSeparation} className="tool-button">Cancel</button>
              ) : (
                <button
                  type="button"
                  onClick={onSeparate}
                  disabled={separationStatus.state === "unsupported" || hasSeparatedStems}
                  className="tool-button tool-button-active"
                  title={hasSeparatedStems ? "Separated stems are already in this session" : "Separate six instruments locally"}
                >
                  <SparklesIcon /> {hasSeparatedStems ? "Separated" : "Separate 6"}
                </button>
              )}
            </div>
            <p
              className={cn(
                "mt-2 text-[9px] leading-3.5 text-tertiary",
                (separationStatus.state === "error" || separationStatus.state === "unsupported") && "text-amber-300",
              )}
              role={separationStatus.state === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {separationCopy(separationStatus)}
            </p>
            {isSeparating ? (
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-control"
                role="progressbar"
                aria-label="Stem separation"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(separationStatus.progress * 100)}
              >
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(separationStatus.progress * 100)}%` }} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <fieldset className="min-w-0">
            <legend className="flex w-full items-center gap-1.5 border-b border-separator px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-tertiary">
              <Music2Icon className="size-3" /> Chords from
              {chordSourceStatus.state === "loading" ? <LoaderCircleIcon className="ml-auto size-3 animate-spin text-accent" /> : null}
            </legend>
            <ul className="min-w-0 divide-y divide-separator" aria-label="Mixer tracks">
              {tracks.map((track) => {
                const effectivelyMuted = track.muted || (anySolo && !track.solo);
                const status = trackStatus(track);
                const statusIsWarning = track.loadState === "error" || track.durationMismatch;
                const selected = chordSourceId === track.id;
                const analyzing = chordSourceStatus.state === "loading" && chordSourceStatus.trackId === track.id;
                const unavailableReason = unavailableChordSourceReason(track);
                const usesBassRootMode = track.kind === "bass";
                // A separated stem knows which model made it. Surfaced on hover
                // rather than in the row: the row already carries five states,
                // and "which Demucs revision" is a question you go looking for.
                const attribution = describeProvenance(track.provenance);
                const sourceStatusId = `${sourceGroupId}-status-${track.id}`;

                return (
                  <li key={track.id} className={cn("relative px-3 py-3 transition-[background-color,opacity]", effectivelyMuted && "opacity-55", selected && "bg-accent/[0.055]")}>
                    <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full" style={{ backgroundColor: track.color }} aria-hidden="true" />

                    <div className="flex min-w-0 items-start gap-2">
                      <label
                        className={cn(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center",
                          unavailableReason ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                        )}
                        title={unavailableReason ?? `Use ${track.name} for chord detection`}
                      >
                        <input
                          type="radio"
                          name={`${sourceGroupId}-chord-source`}
                          value={track.id}
                          checked={selected}
                          disabled={track.loadState !== "ready" || track.durationMismatch || unavailableReason !== null}
                          onChange={() => onChordSourceChange(track.id)}
                          className="size-3.5 accent-current"
                          style={{ color: track.color }}
                          aria-label={unavailableReason ? `Cannot analyze chords from ${track.name}` : `Analyze chords from ${track.name}`}
                          aria-describedby={sourceStatusId}
                        />
                      </label>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium leading-4 text-primary" title={track.name}>{track.name}</p>
                        <p
                          id={sourceStatusId}
                          className={cn("flex items-center gap-1 truncate text-[9px] uppercase leading-3 tracking-[0.1em] text-tertiary", statusIsWarning && "text-amber-400")}
                          title={unavailableReason ?? (statusIsWarning ? status : attribution)}
                        >
                          {statusIsWarning ? <TriangleAlertIcon className="size-2.5 shrink-0" aria-hidden="true" /> : null}
                          {analyzing ? <LoaderCircleIcon className="size-2.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
                          <span className="truncate">
                            {analyzing
                              ? `Reading ${usesBassRootMode ? "bass roots" : "chords"} ${Math.round(chordSourceStatus.progress * 100)}%`
                              : unavailableReason
                                ? `${status} · mix/export only`
                                : usesBassRootMode
                                  ? `${status} · root-note detection`
                                  : status}
                            {unavailableReason ? <span className="sr-only">. {unavailableReason}</span> : null}
                          </span>
                        </p>
                      </div>

                      <button type="button" onClick={() => toggleMute(track.id)} aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} aria-pressed={track.muted} title={`${track.muted ? "Unmute" : "Mute"} ${track.name}`} className={cn("flex size-7 items-center justify-center rounded border text-[9px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-400", track.muted ? "border-amber-400/50 bg-amber-400/20 text-amber-300" : "border-separator bg-well text-tertiary hover:bg-control hover:text-primary")}>M</button>
                      <button type="button" onClick={() => toggleSolo(track.id)} aria-label={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`} aria-pressed={track.solo} title={`${track.solo ? "Unsolo" : "Solo"} ${track.name}`} className={cn("flex size-7 items-center justify-center rounded border text-[9px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent", track.solo ? "border-accent/50 bg-accent/15 text-accent" : "border-separator bg-well text-tertiary hover:bg-control hover:text-primary")}>S</button>
                      {track.origin !== "original" ? (
                        <button type="button" onClick={() => removeTrack(track.id)} aria-label={`Remove ${track.name}`} title={`Remove ${track.name}`} className="flex size-7 items-center justify-center rounded text-tertiary transition-colors hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400 [&_svg]:size-3.5"><Trash2Icon aria-hidden="true" /></button>
                      ) : null}
                    </div>

                    <label className="mt-2.5 flex min-w-0 items-center gap-1.5">
                      <span className="sr-only">{track.name} volume</span>
                      <Volume2Icon className="size-3 shrink-0 text-tertiary" aria-hidden="true" />
                      <input type="range" min={0} max={1} step={0.01} value={track.volume} onChange={(event) => updateTrack(track.id, { volume: Number(event.target.value) })} aria-valuetext={`${Math.round(track.volume * 100)} percent`} className="h-1 min-w-0 flex-1 cursor-pointer accent-current" style={{ color: track.color }} />
                      <span className="w-6 text-right text-[9px] tabular-nums text-tertiary" aria-hidden="true">{Math.round(track.volume * 100)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        </div>

        {chordSourceStatus.state === "error" ? (
          <p className="border-t border-separator px-3 py-2 text-[9px] leading-3.5 text-amber-300" role="alert">{chordSourceStatus.message}</p>
        ) : null}

        <div className="border-t border-separator p-2.5">
          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1 rounded-md border border-separator bg-well px-2 py-1.5">
              <span className="sr-only">Export format</span>
              <select value={exportFormat} onChange={(event) => onExportFormatChange(event.target.value as ExportFormat)} className="w-full bg-transparent text-[10px] font-semibold text-secondary outline-none">
                <option value="wav">WAV · lossless</option>
                <option value="mp3">MP3 · 256 kbps</option>
              </select>
            </label>
            <button type="button" onClick={onExport} disabled={isExporting} className="tool-button tool-button-active min-h-8">
              {isExporting ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
              Export mix
            </button>
          </div>
          <p className={cn("mt-1.5 text-[9px] leading-3.5 text-tertiary", exportStatus.state === "error" && "text-amber-300")} role={exportStatus.state === "error" ? "alert" : "status"}>
            {exportStatus.state === "working"
              ? `${EXPORT_STAGE_LABEL[exportStatus.stage]} · ${Math.round(exportStatus.progress * 100)}%`
              : exportStatus.state === "error"
                ? exportStatus.message
                : exportStatus.state === "done"
                  ? "Download ready"
                  : "Exports the audible mute/solo mix in the selected key."}
          </p>
          {pitchEngineState === "fallback" ? (
            <p className="mt-1 flex items-start gap-1 text-[9px] leading-3.5 text-amber-300"><TriangleAlertIcon className="mt-0.5 size-2.5 shrink-0" /> Live pitch shifting is unavailable in this browser.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
