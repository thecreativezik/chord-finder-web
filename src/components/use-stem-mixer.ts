import { useCallback, useEffect, useRef, useState } from "react";

export const ORIGINAL_MIX_TRACK_ID = "original-mix";
export const STEM_FILE_ACCEPT =
  ".mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.aiff,.aif,.webm,audio/*";

const DRIFT_TOLERANCE_SEC = 0.03;
const DRIFT_CHECK_INTERVAL_MS = 100;

export type StemKind = "original" | "vocals" | "drums" | "bass" | "guitar" | "keys" | "other";
export type StemLoadState = "loading" | "ready" | "error";

export interface StemTrack {
  id: string;
  name: string;
  kind: StemKind;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  imported: boolean;
  durationSec: number | null;
  durationMismatch: boolean;
  loadState: StemLoadState;
}

export type StemTrackUpdate = Partial<Pick<StemTrack, "name" | "volume" | "muted" | "solo">>;

export interface StemMixerControls {
  tracks: StemTrack[];
  addFiles: (files: FileList | readonly File[]) => void;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, update: StemTrackUpdate) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
}

export const STEM_KIND_LABEL: Record<StemKind, string> = {
  original: "Original",
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  keys: "Keys",
  other: "Other",
};

const STEM_KIND_COLOR: Record<StemKind, string> = {
  original: "#60a5fa",
  vocals: "#fb7185",
  drums: "#f59e0b",
  bass: "#a78bfa",
  guitar: "#22d3ee",
  keys: "#facc15",
  other: "#94a3b8",
};

const KIND_RULES: ReadonlyArray<readonly [Exclude<StemKind, "original" | "other">, RegExp]> = [
  ["vocals", /\b(vocals?|vox|voice|voices|acapella|a\s+capella|bgv|backing\s+vocals?)\b/],
  ["drums", /\b(drums?|drumkit|percussion|perc|kick|snare|cymbals?)\b/],
  ["bass", /\b(bass|sub|low\s+end)\b/],
  ["guitar", /\b(guitars?|gtr|acoustic|electric\s+guitar)\b/],
  ["keys", /\b(keys?|keyboards?|pianos?|synths?|synthesizers?|organs?|rhodes)\b/],
];

const AUDIO_FILE_EXTENSION = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aiff?|webm)$/i;

interface AudioResource {
  audio: HTMLAudioElement;
  objectUrl: string;
  onMetadata: () => void;
  onError: () => void;
}

interface StemMetadata {
  name: string;
  kind: Exclude<StemKind, "original">;
  color: string;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function mediaDuration(media: HTMLMediaElement | null): number | null {
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return null;
  return media.duration;
}

function hasDurationMismatch(masterDuration: number | null, stemDuration: number | null): boolean {
  if (masterDuration === null || stemDuration === null) return false;
  // Ignore normal encoder padding while still catching truncated or offset exports.
  const tolerance = Math.max(0.5, Math.min(1.5, masterDuration * 0.002));
  return Math.abs(masterDuration - stemDuration) > tolerance;
}

function createOriginalTrack(masterAudio: HTMLAudioElement | null): StemTrack {
  const durationSec = mediaDuration(masterAudio);
  return {
    id: ORIGINAL_MIX_TRACK_ID,
    name: "Original mix",
    kind: "original",
    color: STEM_KIND_COLOR.original,
    volume: 1,
    muted: false,
    solo: false,
    imported: false,
    durationSec,
    durationMismatch: false,
    loadState: durationSec === null ? "loading" : "ready",
  };
}

function friendlyStemName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const cleaned = withoutExtension
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/^\s*\d{1,3}[\s._-]+/, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Imported stem";

  return cleaned
    .split(" ")
    .map((word) => {
      if (/^[A-Z\d]{2,4}$/.test(word)) return word;
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

/** Infer mixer presentation metadata from common separator export filenames. */
export function inferStemMetadata(fileName: string): StemMetadata {
  const searchable = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z\d]+/g, " ")
    .toLowerCase();
  const match = KIND_RULES.find(([, pattern]) => pattern.test(searchable));
  const kind = match?.[0] ?? "other";

  return {
    name: friendlyStemName(fileName),
    kind,
    color: STEM_KIND_COLOR[kind],
  };
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_FILE_EXTENSION.test(file.name);
}

function setPlaybackRate(audio: HTMLAudioElement, rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) return;
  audio.playbackRate = rate;
  audio.preservesPitch = true;
}

function seekAudio(audio: HTMLAudioElement, targetTime: number, force: boolean): void {
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA || !Number.isFinite(targetTime)) return;

  const duration = mediaDuration(audio);
  const latestTime = duration === null ? targetTime : Math.max(0, duration - 0.01);
  const nextTime = Math.max(0, Math.min(targetTime, latestTime));
  if (!force && Math.abs(audio.currentTime - nextTime) <= DRIFT_TOLERANCE_SEC) return;

  try {
    audio.currentTime = nextTime;
  } catch {
    // Some engines reject seeks while metadata is being replaced. The next
    // metadata event or drift check will align the stem.
  }
}

function canPlayAt(audio: HTMLAudioElement, targetTime: number): boolean {
  const duration = mediaDuration(audio);
  return duration === null || targetTime < duration - 0.01;
}

function disposeResource(resource: AudioResource): void {
  resource.audio.pause();
  resource.audio.removeEventListener("loadedmetadata", resource.onMetadata);
  resource.audio.removeEventListener("durationchange", resource.onMetadata);
  resource.audio.removeEventListener("error", resource.onError);
  resource.audio.removeAttribute("src");
  resource.audio.load();
  URL.revokeObjectURL(resource.objectUrl);
}

function disposeResources(resources: Map<string, AudioResource>): void {
  for (const resource of resources.values()) disposeResource(resource);
  resources.clear();
}

/**
 * Owns imported local stems and makes the supplied master element their
 * transport clock. Imported files never leave the browser.
 */
export function useStemMixer(
  masterAudio: HTMLAudioElement | null,
  sourceKey: string,
  playbackRate: number,
): StemMixerControls {
  const [tracks, setTracks] = useState<StemTrack[]>(() => [createOriginalTrack(masterAudio)]);
  const resourcesRef = useRef(new Map<string, AudioResource>());
  const tracksRef = useRef(tracks);
  const masterRef = useRef(masterAudio);
  const sourceKeyRef = useRef(sourceKey);
  const playbackRateRef = useRef(playbackRate);
  const nextIdRef = useRef(1);
  const originalWasAutoMutedRef = useRef(false);

  tracksRef.current = tracks;
  masterRef.current = masterAudio;
  playbackRateRef.current = playbackRate;

  useEffect(() => {
    if (sourceKeyRef.current === sourceKey) return;

    disposeResources(resourcesRef.current);
    sourceKeyRef.current = sourceKey;
    originalWasAutoMutedRef.current = false;
    setTracks([createOriginalTrack(masterAudio)]);
  }, [masterAudio, sourceKey]);

  useEffect(() => {
    return () => disposeResources(resourcesRef.current);
  }, []);

  // Restore the host element's own mix settings when this hook releases it.
  useEffect(() => {
    if (!masterAudio) return;
    const initialMuted = masterAudio.muted;
    const initialVolume = masterAudio.volume;

    return () => {
      masterAudio.muted = initialMuted;
      masterAudio.volume = initialVolume;
    };
  }, [masterAudio]);

  useEffect(() => {
    if (!masterAudio) return;

    const updateMasterDuration = () => {
      const durationSec = mediaDuration(masterAudio);
      setTracks((current) =>
        current.map((track) =>
          track.id === ORIGINAL_MIX_TRACK_ID
            ? {
                ...track,
                durationSec,
                loadState: durationSec === null ? track.loadState : "ready",
              }
            : {
                ...track,
                durationMismatch: hasDurationMismatch(durationSec, track.durationSec),
              },
        ),
      );
    };

    masterAudio.addEventListener("loadedmetadata", updateMasterDuration);
    masterAudio.addEventListener("durationchange", updateMasterDuration);
    if (masterAudio.readyState >= HTMLMediaElement.HAVE_METADATA) updateMasterDuration();

    return () => {
      masterAudio.removeEventListener("loadedmetadata", updateMasterDuration);
      masterAudio.removeEventListener("durationchange", updateMasterDuration);
    };
  }, [masterAudio, sourceKey]);

  useEffect(() => {
    const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    for (const resource of resourcesRef.current.values()) {
      setPlaybackRate(resource.audio, safeRate);
    }
  }, [playbackRate]);

  useEffect(() => {
    if (!masterAudio) return;

    const masterRate = () => {
      if (Number.isFinite(masterAudio.playbackRate) && masterAudio.playbackRate > 0) {
        return masterAudio.playbackRate;
      }
      return playbackRateRef.current;
    };

    const alignAll = (forceSeek: boolean, shouldPlay: boolean) => {
      const time = masterAudio.currentTime;
      const rate = masterRate();
      for (const resource of resourcesRef.current.values()) {
        const stem = resource.audio;
        setPlaybackRate(stem, rate);
        seekAudio(stem, time, forceSeek);
        if (shouldPlay && canPlayAt(stem, time)) {
          if (stem.paused) void stem.play().catch(() => undefined);
        } else if (!stem.paused) {
          stem.pause();
        }
      }
    };

    const pauseAndAlign = () => alignAll(true, false);
    const playAndAlign = () => alignAll(true, true);
    const resumeAndAlign = () => alignAll(false, true);
    const onSeeked = () => alignAll(true, !masterAudio.paused && !masterAudio.ended);
    const onRateChange = () => {
      const rate = masterRate();
      for (const resource of resourcesRef.current.values()) {
        setPlaybackRate(resource.audio, rate);
      }
    };

    masterAudio.addEventListener("play", playAndAlign);
    masterAudio.addEventListener("playing", resumeAndAlign);
    masterAudio.addEventListener("pause", pauseAndAlign);
    masterAudio.addEventListener("ended", pauseAndAlign);
    masterAudio.addEventListener("waiting", pauseAndAlign);
    masterAudio.addEventListener("seeking", pauseAndAlign);
    masterAudio.addEventListener("seeked", onSeeked);
    masterAudio.addEventListener("ratechange", onRateChange);

    alignAll(true, !masterAudio.paused && !masterAudio.ended);

    const driftTimer = window.setInterval(() => {
      if (masterAudio.paused || masterAudio.ended || masterAudio.seeking) return;

      const time = masterAudio.currentTime;
      const rate = masterRate();
      for (const resource of resourcesRef.current.values()) {
        const stem = resource.audio;
        setPlaybackRate(stem, rate);
        seekAudio(stem, time, false);
        if (stem.paused && canPlayAt(stem, time)) void stem.play().catch(() => undefined);
      }
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(driftTimer);
      masterAudio.removeEventListener("play", playAndAlign);
      masterAudio.removeEventListener("playing", resumeAndAlign);
      masterAudio.removeEventListener("pause", pauseAndAlign);
      masterAudio.removeEventListener("ended", pauseAndAlign);
      masterAudio.removeEventListener("waiting", pauseAndAlign);
      masterAudio.removeEventListener("seeking", pauseAndAlign);
      masterAudio.removeEventListener("seeked", onSeeked);
      masterAudio.removeEventListener("ratechange", onRateChange);
      for (const resource of resourcesRef.current.values()) resource.audio.pause();
    };
  }, [masterAudio, sourceKey]);

  useEffect(() => {
    const anySolo = tracks.some((track) => track.solo);

    for (const track of tracks) {
      const audible = !track.muted && (!anySolo || track.solo);
      const audio =
        track.id === ORIGINAL_MIX_TRACK_ID
          ? masterAudio
          : resourcesRef.current.get(track.id)?.audio ?? null;
      if (!audio) continue;
      audio.volume = clampVolume(track.volume);
      audio.muted = !audible;
    }
  }, [masterAudio, tracks]);

  const addFiles = useCallback((files: FileList | readonly File[]) => {
    const acceptedFiles = Array.from(files).filter(isAudioFile);
    if (acceptedFiles.length === 0) return;

    const hadImportedTracks = resourcesRef.current.size > 0;
    const master = masterRef.current;
    const masterDuration = mediaDuration(master);
    const newTracks: StemTrack[] = [];

    for (const file of acceptedFiles) {
      const id = `stem-${Date.now().toString(36)}-${nextIdRef.current++}`;
      const metadata = inferStemMetadata(file.name);
      const objectUrl = URL.createObjectURL(file);
      const audio = new Audio();
      audio.preload = "auto";
      setPlaybackRate(audio, playbackRateRef.current);

      const onMetadata = () => {
        const durationSec = mediaDuration(audio);
        setTracks((current) =>
          current.map((track) =>
            track.id === id
              ? {
                  ...track,
                  durationSec,
                  durationMismatch: hasDurationMismatch(mediaDuration(masterRef.current), durationSec),
                  loadState: "ready",
                }
              : track,
          ),
        );

        const currentMaster = masterRef.current;
        if (!currentMaster) return;
        setPlaybackRate(audio, currentMaster.playbackRate || playbackRateRef.current);
        seekAudio(audio, currentMaster.currentTime, true);
        if (!currentMaster.paused && !currentMaster.ended && canPlayAt(audio, currentMaster.currentTime)) {
          void audio.play().catch(() => undefined);
        }
      };

      const onError = () => {
        setTracks((current) =>
          current.map((track) => (track.id === id ? { ...track, loadState: "error" } : track)),
        );
      };

      const resource: AudioResource = { audio, objectUrl, onMetadata, onError };
      resourcesRef.current.set(id, resource);
      audio.addEventListener("loadedmetadata", onMetadata);
      audio.addEventListener("durationchange", onMetadata);
      audio.addEventListener("error", onError);
      audio.src = objectUrl;
      audio.load();

      const durationSec = mediaDuration(audio);
      newTracks.push({
        id,
        name: metadata.name,
        kind: metadata.kind,
        color: metadata.color,
        volume: 1,
        muted: false,
        solo: false,
        imported: true,
        durationSec,
        durationMismatch: hasDurationMismatch(masterDuration, durationSec),
        loadState: durationSec === null ? "loading" : "ready",
      });
    }

    if (!hadImportedTracks) {
      const original = tracksRef.current.find((track) => track.id === ORIGINAL_MIX_TRACK_ID);
      originalWasAutoMutedRef.current = original ? !original.muted : false;
    }

    setTracks((current) => [
      ...current.map((track) =>
        !hadImportedTracks && track.id === ORIGINAL_MIX_TRACK_ID
          ? { ...track, muted: true }
          : track,
      ),
      ...newTracks,
    ]);
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    if (trackId === ORIGINAL_MIX_TRACK_ID) return;

    const resource = resourcesRef.current.get(trackId);
    if (resource) {
      disposeResource(resource);
      resourcesRef.current.delete(trackId);
    }

    const shouldRestoreOriginal =
      resourcesRef.current.size === 0 && originalWasAutoMutedRef.current;
    if (shouldRestoreOriginal) originalWasAutoMutedRef.current = false;

    setTracks((current) =>
      current
        .filter((track) => track.id !== trackId)
        .map((track) =>
          shouldRestoreOriginal && track.id === ORIGINAL_MIX_TRACK_ID
            ? { ...track, muted: false }
            : track,
        ),
    );
  }, []);

  const updateTrack = useCallback((trackId: string, update: StemTrackUpdate) => {
    if (trackId === ORIGINAL_MIX_TRACK_ID && update.muted !== undefined) {
      originalWasAutoMutedRef.current = false;
    }

    setTracks((current) =>
      current.map((track) => {
        if (track.id !== trackId) return track;
        return {
          ...track,
          ...(update.name !== undefined && update.name.trim()
            ? { name: update.name.trim() }
            : null),
          ...(update.volume !== undefined ? { volume: clampVolume(update.volume) } : null),
          ...(update.muted !== undefined ? { muted: update.muted } : null),
          ...(update.solo !== undefined ? { solo: update.solo } : null),
        };
      }),
    );
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    if (trackId === ORIGINAL_MIX_TRACK_ID) originalWasAutoMutedRef.current = false;
    setTracks((current) =>
      current.map((track) =>
        track.id === trackId ? { ...track, muted: !track.muted } : track,
      ),
    );
  }, []);

  const toggleSolo = useCallback((trackId: string) => {
    setTracks((current) =>
      current.map((track) => (track.id === trackId ? { ...track, solo: !track.solo } : track)),
    );
  }, []);

  return { tracks, addFiles, removeTrack, updateTrack, toggleMute, toggleSolo };
}
