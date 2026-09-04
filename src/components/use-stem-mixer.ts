import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  estimateSoundTouchSourceLatencySec,
  isSoundTouchNeutral,
  SOUND_TOUCH_STRETCH_PARAMETERS,
} from "../audio/soundtouch-config";

export const ORIGINAL_MIX_TRACK_ID = "original-mix";
export const STEM_FILE_ACCEPT =
  ".mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.aiff,.aif,.webm,audio/*";

const DRIFT_TOLERANCE_SEC = 0.03;
const DRIFT_CHECK_INTERVAL_MS = 100;

export type StemKind = "original" | "vocals" | "drums" | "bass" | "guitar" | "keys" | "other";
export type StemLoadState = "loading" | "ready" | "error";
export type StemOrigin = "original" | "imported" | "separated";
export type PitchEngineState = "loading" | "ready" | "fallback";

export interface StemTrack {
  id: string;
  name: string;
  kind: StemKind;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  origin: StemOrigin;
  durationSec: number | null;
  durationMismatch: boolean;
  loadState: StemLoadState;
}

export interface StemAssetInput {
  name: string;
  kind: Exclude<StemKind, "original">;
  blob: Blob;
  origin: Exclude<StemOrigin, "original">;
}

export interface StemTrackAsset {
  track: StemTrack;
  blob: Blob;
}

export type StemTrackUpdate = Partial<Pick<StemTrack, "name" | "volume" | "muted" | "solo">>;

export interface StemMixerControls {
  tracks: StemTrack[];
  pitchEngineState: PitchEngineState;
  /** DSP delay in the source timeline used by the chord playhead and click. */
  sourceLatencySec: number;
  addFiles: (files: FileList | readonly File[]) => void;
  addAssets: (assets: readonly StemAssetInput[]) => void;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, update: StemTrackUpdate) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  getTrackAsset: (trackId: string) => StemTrackAsset | null;
  getAudibleAssets: () => StemTrackAsset[];
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

interface GraphConnection {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  connected: boolean;
}

interface SharedAudioGraph {
  context: AudioContext;
  mixBus: GainNode;
  pitchNode: SoundTouchNode;
  connections: Map<HTMLMediaElement, GraphConnection>;
  route: "direct" | "processed" | null;
  processorPitchSemitones: number;
  processorPlaybackRate: number;
}

interface AudioResource {
  audio: HTMLAudioElement;
  blob: Blob;
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
    origin: "original",
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
    .map((word) => (/^[A-Z\d]{2,4}$/.test(word)
      ? word
      : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join(" ");
}

export function inferStemMetadata(fileName: string): StemMetadata {
  const searchable = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z\d]+/g, " ")
    .toLowerCase();
  const match = KIND_RULES.find(([, pattern]) => pattern.test(searchable));
  const kind = match?.[0] ?? "other";
  return { name: friendlyStemName(fileName), kind, color: STEM_KIND_COLOR[kind] };
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_FILE_EXTENSION.test(file.name);
}

function setPlaybackRate(audio: HTMLAudioElement, rate: number, graphReady: boolean): void {
  if (!Number.isFinite(rate) || rate <= 0) return;
  audio.playbackRate = rate;
  audio.preservesPitch = !graphReady;
}

function configureGraphRoute(graph: SharedAudioGraph, shouldProcess: boolean): void {
  const route = shouldProcess ? "processed" : "direct";
  if (graph.route === route) return;
  graph.mixBus.disconnect();
  graph.pitchNode.disconnect();
  if (shouldProcess) graph.mixBus.connect(graph.pitchNode).connect(graph.context.destination);
  else graph.mixBus.connect(graph.context.destination);
  graph.route = route;
}

function createPitchNode(
  context: AudioContext,
  pitchSemitones: number,
  playbackRate: number,
): SoundTouchNode {
  const node = new SoundTouchNode({ context });
  node.pitchSemitones.value = pitchSemitones;
  node.playbackRate.value = playbackRate;
  node.setStretchParameters(SOUND_TOUCH_STRETCH_PARAMETERS);
  return node;
}

/** Replace the worklet to clear SoundTouch's private FIFO after seeks/pauses. */
function replacePitchNode(
  graph: SharedAudioGraph,
  pitchSemitones: number,
  playbackRate: number,
): void {
  graph.mixBus.disconnect();
  graph.pitchNode.disconnect();
  graph.pitchNode.port.close();
  graph.pitchNode = createPitchNode(graph.context, pitchSemitones, playbackRate);
  graph.processorPitchSemitones = pitchSemitones;
  graph.processorPlaybackRate = playbackRate;
  graph.route = null;
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
    // A metadata replacement can reject a seek; the next drift check retries.
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

/** Owns aligned stems and a shared, tempo-preserving pitch-shift bus. */
export function useStemMixer(
  masterAudio: HTMLAudioElement | null,
  sourceKey: string,
  playbackRate: number,
  masterBlob: Blob | null,
  pitchSemitones: number,
): StemMixerControls {
  const [tracks, setTracks] = useState<StemTrack[]>(() => [createOriginalTrack(masterAudio)]);
  const [pitchEngineState, setPitchEngineState] = useState<PitchEngineState>("loading");
  const resourcesRef = useRef(new Map<string, AudioResource>());
  const tracksRef = useRef(tracks);
  const masterRef = useRef(masterAudio);
  const masterBlobRef = useRef(masterBlob);
  const sourceKeyRef = useRef(sourceKey);
  const playbackRateRef = useRef(playbackRate);
  const pitchRef = useRef(pitchSemitones);
  const nextIdRef = useRef(1);
  const originalWasAutoMutedRef = useRef(false);
  const graphRef = useRef<SharedAudioGraph | null>(null);
  const graphPromiseRef = useRef<Promise<SharedAudioGraph> | null>(null);
  const graphRequestRef = useRef(0);
  const disposedRef = useRef(false);

  tracksRef.current = tracks;
  masterRef.current = masterAudio;
  masterBlobRef.current = masterBlob;
  playbackRateRef.current = playbackRate;
  pitchRef.current = pitchSemitones;

  const ensureGraph = useCallback(async (): Promise<SharedAudioGraph> => {
    if (graphRef.current) return graphRef.current;
    if (graphPromiseRef.current) return graphPromiseRef.current;
    setPitchEngineState("loading");
    const requestId = ++graphRequestRef.current;
    let graphPromise: Promise<SharedAudioGraph>;
    graphPromise = (async () => {
      const context = new AudioContext();
      try {
        await SoundTouchNode.register(context, processorUrl);
        if (disposedRef.current || requestId !== graphRequestRef.current) {
          throw new DOMException("Audio graph initialization was superseded.", "AbortError");
        }
        const mixBus = context.createGain();
        const pitchNode = createPitchNode(context, pitchRef.current, playbackRateRef.current);
        const graph: SharedAudioGraph = {
          context,
          mixBus,
          pitchNode,
          connections: new Map(),
          route: null,
          processorPitchSemitones: pitchRef.current,
          processorPlaybackRate: playbackRateRef.current,
        };
        configureGraphRoute(
          graph,
          !isSoundTouchNeutral(pitchRef.current, playbackRateRef.current),
        );
        graphRef.current = graph;
        setPitchEngineState("ready");
        return graph;
      } catch (error) {
        if (context.state !== "closed") {
          await context.close().catch(() => undefined);
        }
        throw error;
      }
    })().catch((error) => {
      if (graphPromiseRef.current === graphPromise) {
        graphPromiseRef.current = null;
        if (!disposedRef.current) {
          console.warn("[chord-finder] Pitch engine unavailable; using native playback.", error);
          setPitchEngineState("fallback");
        }
      }
      throw error;
    });
    graphPromiseRef.current = graphPromise;
    return graphPromise;
  }, []);

  const isCurrentAudio = useCallback((audio: HTMLMediaElement): boolean => {
    if (disposedRef.current) return false;
    if (audio === masterRef.current) return true;
    for (const resource of resourcesRef.current.values()) {
      if (resource.audio === audio) return true;
    }
    return false;
  }, []);

  const connectAudio = useCallback(async (audio: HTMLAudioElement) => {
    try {
      const graph = await ensureGraph();
      if (!isCurrentAudio(audio) || graphRef.current !== graph || graph.context.state === "closed") return;
      let connection = graph.connections.get(audio);
      if (!connection) {
        const source = graph.context.createMediaElementSource(audio);
        const gain = graph.context.createGain();
        connection = { source, gain, connected: false };
        graph.connections.set(audio, connection);
      }
      if (!connection.connected) {
        connection.source.connect(connection.gain);
        connection.gain.connect(graph.mixBus);
        connection.connected = true;
      }
      audio.muted = false;
      audio.volume = 1;
      setPlaybackRate(audio, playbackRateRef.current, graph.route === "processed");
      const track = audio === masterRef.current
        ? tracksRef.current.find((candidate) => candidate.id === ORIGINAL_MIX_TRACK_ID)
        : tracksRef.current.find((candidate) => resourcesRef.current.get(candidate.id)?.audio === audio);
      const anySolo = tracksRef.current.some((candidate) => candidate.solo);
      if (track) connection.gain.gain.value = !track.muted && (!anySolo || track.solo) ? track.volume : 0;
    } catch {
      if (isCurrentAudio(audio)) setPlaybackRate(audio, playbackRateRef.current, false);
    }
  }, [ensureGraph, isCurrentAudio]);

  const disconnectAudio = useCallback((audio: HTMLMediaElement, forget = true) => {
    const connection = graphRef.current?.connections.get(audio);
    if (!connection) return;
    if (connection.connected) {
      connection.source.disconnect();
      connection.gain.disconnect();
      connection.connected = false;
    }
    if (forget) graphRef.current?.connections.delete(audio);
  }, []);

  const resetProcessedPipeline = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || graph.route !== "processed" || graph.context.state === "closed") return;
    replacePitchNode(graph, pitchRef.current, playbackRateRef.current);
    configureGraphRoute(graph, true);
  }, []);

  const disposeStemResources = useCallback(() => {
    for (const resource of resourcesRef.current.values()) {
      disconnectAudio(resource.audio);
      disposeResource(resource);
    }
    resourcesRef.current.clear();
  }, [disconnectAudio]);

  useEffect(() => {
    if (sourceKeyRef.current === sourceKey) return;
    disposeStemResources();
    sourceKeyRef.current = sourceKey;
    originalWasAutoMutedRef.current = false;
    setTracks([createOriginalTrack(masterAudio)]);
  }, [disposeStemResources, masterAudio, sourceKey]);

  useEffect(() => {
    if (!masterAudio) return;
    void connectAudio(masterAudio);
    return () => {
      // React Strict Mode can replay an effect with the same element. Keep its
      // source node available for reconnection because a media element may only
      // be wrapped by createMediaElementSource once per AudioContext.
      disconnectAudio(masterAudio, masterRef.current !== masterAudio);
    };
  }, [connectAudio, disconnectAudio, masterAudio]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      graphRequestRef.current += 1;
      disposeStemResources();
      const graph = graphRef.current;
      graphRef.current = null;
      graphPromiseRef.current = null;
      if (!graph) return;
      for (const connection of graph.connections.values()) {
        if (connection.connected) {
          connection.source.disconnect();
          connection.gain.disconnect();
          connection.connected = false;
        }
      }
      graph.connections.clear();
      graph.mixBus.disconnect();
      graph.pitchNode.disconnect();
      graph.pitchNode.port.close();
      void graph.context.close();
    };
  }, [disposeStemResources]);

  useEffect(() => {
    const graph = graphRef.current;
    const shouldProcess = !isSoundTouchNeutral(pitchSemitones, playbackRate);
    if (graph) {
      const processorChanged = Math.abs(graph.processorPitchSemitones - pitchSemitones) >= 0.001
        || Math.abs(graph.processorPlaybackRate - playbackRate) >= 0.001;
      if (
        graph.route === "processed"
        && (processorChanged || !shouldProcess)
        && masterAudio
        && !masterAudio.paused
      ) {
        const oldLatency = estimateSoundTouchSourceLatencySec(
          graph.processorPitchSemitones,
          graph.processorPlaybackRate,
          graph.context.sampleRate,
        );
        seekAudio(masterAudio, Math.max(0, masterAudio.currentTime - oldLatency), true);
      }
      if (shouldProcess && (graph.route !== "processed" || processorChanged)) {
        replacePitchNode(graph, pitchSemitones, playbackRate);
      }
      configureGraphRoute(graph, shouldProcess);
    }
    const ready = Boolean(graph) && shouldProcess;
    if (masterAudio) setPlaybackRate(masterAudio, playbackRate, ready);
    for (const resource of resourcesRef.current.values()) setPlaybackRate(resource.audio, playbackRate, ready);
  }, [masterAudio, pitchSemitones, playbackRate]);

  useEffect(() => {
    if (!masterAudio) return;
    const updateMasterDuration = () => {
      const durationSec = mediaDuration(masterAudio);
      setTracks((current) => current.map((track) => track.id === ORIGINAL_MIX_TRACK_ID
        ? { ...track, durationSec, loadState: durationSec === null ? track.loadState : "ready" }
        : { ...track, durationMismatch: hasDurationMismatch(durationSec, track.durationSec) }));
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
    if (!masterAudio) return;
    const masterRate = () => Number.isFinite(masterAudio.playbackRate) && masterAudio.playbackRate > 0
      ? masterAudio.playbackRate
      : playbackRateRef.current;
    const alignAll = (forceSeek: boolean, shouldPlay: boolean) => {
      const time = masterAudio.currentTime;
      const rate = masterRate();
      const ready = graphRef.current?.route === "processed";
      for (const resource of resourcesRef.current.values()) {
        const stem = resource.audio;
        setPlaybackRate(stem, rate, ready);
        seekAudio(stem, time, forceSeek);
        if (shouldPlay && canPlayAt(stem, time)) {
          if (stem.paused) void stem.play().catch(() => undefined);
        } else if (!stem.paused) stem.pause();
      }
    };
    const pauseAndAlign = () => {
      const graph = graphRef.current;
      if (graph?.route === "processed" && !masterAudio.ended) {
        const latency = estimateSoundTouchSourceLatencySec(
          graph.processorPitchSemitones,
          graph.processorPlaybackRate,
          graph.context.sampleRate,
        );
        seekAudio(masterAudio, Math.max(0, masterAudio.currentTime - latency), true);
      }
      resetProcessedPipeline();
      alignAll(true, false);
    };
    const playAndAlign = () => {
      const context = graphRef.current?.context;
      if (context?.state === "suspended") void context.resume();
      alignAll(true, true);
    };
    const resumeAndAlign = () => alignAll(false, true);
    const onSeeking = () => {
      alignAll(true, false);
      resetProcessedPipeline();
    };
    const onSeeked = () => alignAll(true, !masterAudio.paused && !masterAudio.ended);
    const onRateChange = () => alignAll(false, !masterAudio.paused && !masterAudio.ended);
    masterAudio.addEventListener("play", playAndAlign);
    masterAudio.addEventListener("playing", resumeAndAlign);
    masterAudio.addEventListener("pause", pauseAndAlign);
    masterAudio.addEventListener("ended", pauseAndAlign);
    masterAudio.addEventListener("waiting", pauseAndAlign);
    masterAudio.addEventListener("seeking", onSeeking);
    masterAudio.addEventListener("seeked", onSeeked);
    masterAudio.addEventListener("ratechange", onRateChange);
    alignAll(true, !masterAudio.paused && !masterAudio.ended);
    const driftTimer = window.setInterval(() => {
      if (!masterAudio.paused && !masterAudio.ended && !masterAudio.seeking) alignAll(false, true);
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(driftTimer);
      masterAudio.removeEventListener("play", playAndAlign);
      masterAudio.removeEventListener("playing", resumeAndAlign);
      masterAudio.removeEventListener("pause", pauseAndAlign);
      masterAudio.removeEventListener("ended", pauseAndAlign);
      masterAudio.removeEventListener("waiting", pauseAndAlign);
      masterAudio.removeEventListener("seeking", onSeeking);
      masterAudio.removeEventListener("seeked", onSeeked);
      masterAudio.removeEventListener("ratechange", onRateChange);
      for (const resource of resourcesRef.current.values()) resource.audio.pause();
    };
  }, [masterAudio, resetProcessedPipeline, sourceKey]);

  useEffect(() => {
    const anySolo = tracks.some((track) => track.solo);
    for (const track of tracks) {
      const audible = !track.muted && (!anySolo || track.solo);
      const audio = track.id === ORIGINAL_MIX_TRACK_ID
        ? masterAudio
        : resourcesRef.current.get(track.id)?.audio ?? null;
      if (!audio) continue;
      const connection = graphRef.current?.connections.get(audio);
      if (connection) {
        audio.muted = false;
        audio.volume = 1;
        connection.gain.gain.value = audible ? clampVolume(track.volume) : 0;
      } else {
        audio.volume = clampVolume(track.volume);
        audio.muted = !audible;
      }
    }
  }, [masterAudio, pitchEngineState, tracks]);

  const addAssets = useCallback((assets: readonly StemAssetInput[]) => {
    if (assets.length === 0) return;
    const hadStemTracks = resourcesRef.current.size > 0;
    const master = masterRef.current;
    const masterDuration = mediaDuration(master);
    const newTracks: StemTrack[] = [];

    for (const asset of assets) {
      const id = `stem-${Date.now().toString(36)}-${nextIdRef.current++}`;
      const objectUrl = URL.createObjectURL(asset.blob);
      const audio = new Audio();
      audio.preload = "auto";
      setPlaybackRate(audio, playbackRateRef.current, graphRef.current?.route === "processed");
      const onMetadata = () => {
        const durationSec = mediaDuration(audio);
        setTracks((current) => current.map((track) => track.id === id
          ? {
              ...track,
              durationSec,
              durationMismatch: hasDurationMismatch(mediaDuration(masterRef.current), durationSec),
              loadState: "ready",
            }
          : track));
        const currentMaster = masterRef.current;
        if (!currentMaster) return;
        setPlaybackRate(
          audio,
          currentMaster.playbackRate || playbackRateRef.current,
          graphRef.current?.route === "processed",
        );
        seekAudio(audio, currentMaster.currentTime, true);
        if (!currentMaster.paused && !currentMaster.ended && canPlayAt(audio, currentMaster.currentTime)) {
          void audio.play().catch(() => undefined);
        }
      };
      const onError = () => setTracks((current) => current.map((track) =>
        track.id === id ? { ...track, loadState: "error" } : track));
      resourcesRef.current.set(id, { audio, blob: asset.blob, objectUrl, onMetadata, onError });
      audio.addEventListener("loadedmetadata", onMetadata);
      audio.addEventListener("durationchange", onMetadata);
      audio.addEventListener("error", onError);
      audio.src = objectUrl;
      audio.load();
      void connectAudio(audio);
      const durationSec = mediaDuration(audio);
      newTracks.push({
        id,
        name: asset.name,
        kind: asset.kind,
        color: STEM_KIND_COLOR[asset.kind],
        volume: 1,
        muted: false,
        solo: false,
        origin: asset.origin,
        durationSec,
        durationMismatch: hasDurationMismatch(masterDuration, durationSec),
        loadState: durationSec === null ? "loading" : "ready",
      });
    }

    if (!hadStemTracks) {
      const original = tracksRef.current.find((track) => track.id === ORIGINAL_MIX_TRACK_ID);
      originalWasAutoMutedRef.current = original ? !original.muted : false;
    }
    setTracks((current) => [
      ...current.map((track) => !hadStemTracks && track.id === ORIGINAL_MIX_TRACK_ID
        ? { ...track, muted: true }
        : track),
      ...newTracks,
    ]);
  }, [connectAudio]);

  const addFiles = useCallback((files: FileList | readonly File[]) => {
    addAssets(Array.from(files).filter(isAudioFile).map((file) => {
      const metadata = inferStemMetadata(file.name);
      return { name: metadata.name, kind: metadata.kind, blob: file, origin: "imported" as const };
    }));
  }, [addAssets]);

  const removeTrack = useCallback((trackId: string) => {
    if (trackId === ORIGINAL_MIX_TRACK_ID) return;
    const resource = resourcesRef.current.get(trackId);
    if (resource) {
      disconnectAudio(resource.audio);
      disposeResource(resource);
      resourcesRef.current.delete(trackId);
    }
    const shouldRestoreOriginal = resourcesRef.current.size === 0 && originalWasAutoMutedRef.current;
    if (shouldRestoreOriginal) originalWasAutoMutedRef.current = false;
    setTracks((current) => current
      .filter((track) => track.id !== trackId)
      .map((track) => shouldRestoreOriginal && track.id === ORIGINAL_MIX_TRACK_ID
        ? { ...track, muted: false }
        : track));
  }, [disconnectAudio]);

  const updateTrack = useCallback((trackId: string, update: StemTrackUpdate) => {
    if (trackId === ORIGINAL_MIX_TRACK_ID && update.muted !== undefined) originalWasAutoMutedRef.current = false;
    setTracks((current) => current.map((track) => track.id === trackId
      ? {
          ...track,
          ...(update.name !== undefined && update.name.trim() ? { name: update.name.trim() } : null),
          ...(update.volume !== undefined ? { volume: clampVolume(update.volume) } : null),
          ...(update.muted !== undefined ? { muted: update.muted } : null),
          ...(update.solo !== undefined ? { solo: update.solo } : null),
        }
      : track));
  }, []);

  const toggleMute = useCallback((trackId: string) => {
    if (trackId === ORIGINAL_MIX_TRACK_ID) originalWasAutoMutedRef.current = false;
    setTracks((current) => current.map((track) => track.id === trackId
      ? { ...track, muted: !track.muted }
      : track));
  }, []);

  const toggleSolo = useCallback((trackId: string) => {
    setTracks((current) => current.map((track) => track.id === trackId
      ? { ...track, solo: !track.solo }
      : track));
  }, []);

  const getTrackAsset = useCallback((trackId: string): StemTrackAsset | null => {
    const track = tracksRef.current.find((candidate) => candidate.id === trackId);
    if (!track) return null;
    const blob = trackId === ORIGINAL_MIX_TRACK_ID
      ? masterBlobRef.current
      : resourcesRef.current.get(trackId)?.blob ?? null;
    return blob ? { track, blob } : null;
  }, []);

  const getAudibleAssets = useCallback((): StemTrackAsset[] => {
    const current = tracksRef.current;
    const anySolo = current.some((track) => track.solo);
    return current
      // A mismatched imported stem is still part of the live mix. Export uses
      // the original song length and safely truncates or pads each decoded
      // asset, so omitting it here would make the download differ from what
      // the musician actually hears.
      .filter((track) => track.loadState === "ready")
      .filter((track) => !track.muted && (!anySolo || track.solo))
      .map((track) => getTrackAsset(track.id))
      .filter((asset): asset is StemTrackAsset => asset !== null);
  }, [getTrackAsset]);

  const sourceLatencySec = pitchEngineState === "ready"
    ? estimateSoundTouchSourceLatencySec(
        pitchSemitones,
        playbackRate,
        graphRef.current?.context.sampleRate,
      )
    : 0;

  return {
    tracks,
    pitchEngineState,
    sourceLatencySec,
    addFiles,
    addAssets,
    removeTrack,
    updateTrack,
    toggleMute,
    toggleSolo,
    getTrackAsset,
    getAudibleAssets,
  };
}
