# Moises product teardown and Chord Finder roadmap

Research date: 2026-09-04  
Scope: Moises Studio, the Moises Musician's App, official product/help media, and viable stem-separation technology for this repository.

## Executive recommendation

Chord Finder should become a **chord-first practice studio**, not a smaller clone of a general DAW. Its durable advantage is a single musical session model in which the source audio, beat grid, key, editable chords, loops, practice mix, and future generated accompaniment all refer to the same timeline.

The best near-term product is:

1. Analyze a song locally.
2. Let an instrumentalist see and correct its chords, scale-degree numbers, and solfa, then audition notes on a playable keyboard.
3. Let them slow it down, transpose the whole session, loop a difficult range, hear a detected-beat-synchronized click, and choose capo-relative chord symbols.
4. Separate the source locally into six broad instrument stems, or import already aligned stems, and practice against a custom mix.
5. Let harmonic stems drive the chord lane and let bass drive an explicitly root-only lane, while the original beat grid remains the transport clock.
6. Export the audible practice mix to WAV or MP3.
7. Add generation only when it is section-scoped, chord-aware, non-destructive, and honest about provenance.

This pass implements steps 1–6 as a local-first vertical slice. It does **not**
claim raw-audio ingestion from commercial streaming services, and it still does
not add a decorative “generate” control without a working generation provider.

## What Moises actually offers

The two Moises surfaces most relevant to this project are distinct:

- **Moises Studio** is the desktop/browser creation workspace: a dark multitrack editor with stem separation, contextual generation, audio/MIDI recording, editing, mixing, mastering, collaboration, and broad export. See the current [Moises Studio product page](https://moises.ai/products/moises-studio/) and [September 2026 launch announcement](https://moises.ai/newsroom/product-announcements/moises-launches-studio-collaborative-workspace/).
- **The Musician's App** is the compact practice player: stem mix, chord views, lyrics, sections, speed, pitch/key, capo, metronome, setlists, and recording. See the [Moises App product page](https://moises.ai/products/moises-app/) and [current feature index](https://moises.ai/features/).

The key product lesson is the shared musical data model:

```text
                         ┌─ chord / diagram views
audio ──> musical map ───┼─ speed, click, count-in, loops
          beats          ├─ source + separated stem mix
          tempo          ├─ section-aware generated parts
          key            ├─ recording and take comparison
          chords         └─ chart, MIDI, stems, mix, project export
          sections
```

That relationship is more valuable than copying Moises's colors, icons, dimensions, wording, imagery, or motion.

## Feature inventory and what belongs in Chord Finder

| Area | Observed Moises capability | Chord Finder interpretation | Delivery |
| --- | --- | --- | --- |
| Stem separation | Automatic and custom source separation; detailed vocals, guitars, drums, bass, keys, strings, winds, and percussion; Hi-Fi option | Local six-source preview for drums, bass, vocals, guitar, piano/keys, and other; broader custom taxonomy needs another engine | Now — WebGPU beta |
| Stem hierarchy | The original remains intact and resulting stems appear as child tracks | Non-destructive original plus labeled, aligned separated/imported tracks | Now |
| Practice mix | Per-stem volume, mute, solo, and pan | Transport-linked mixer with saved presets such as “Hear my part” and “Backing band” | Now — base shipped; presets Release 1 |
| Stem generation | Drums, bass, guitar, keys, and strings generated from project context, presets, prompts, or references | Generate a chord-aware backing part for one selected section; audio or MIDI | Later — Release 3 |
| Generation control | Follow strength, conditioning, Use Project Chords, Hi-Fi, preview model, and MIDI options | Basic preset first; advanced creativity/context controls behind disclosure | Later — Release 3 |
| Regeneration | Selected ranges produce labeled alternative takes | “Try another take” creates an A/B variant and never overwrites a good result | Later — Release 3 |
| Chord detection | Multiple complexity levels, current/next, strip, beat grid, diagrams, corrections | Editable chord lane, stem-aware harmony/root analysis, playable piano plus guitar/bass fretboards, and number/solfa context | Now — core shipped |
| Capo and transposition | Capo shapes, key shifting, notation settings | Preserve the analyzed chord separately while transposing displayed chords, playback audio, keyboard context, and exported mix | Now |
| Practice transport | Speed, pitch/key, Smart Metronome, subdivisions, count-in, looping | One persistent practice cockpit with speed, A/B or section loops, click, key, count-in | Now — speed/loop/click shipped; rest Release 1 |
| Sections | AI Intro/Verse/Chorus markers and adjacent-section loops | Detect or author named regions; use them for practice, navigation, and generation | Next — Release 1 |
| Lyrics | AI lyric transcription and chord-synchronized lyric views | Optional lyrics lane; no need to block the instrumental workflow | Later |
| Recording | Audio/MIDI tracks, record arm, count-in, take lanes, comping | Lightweight “record my take” and A/B against the isolated reference | Next — Release 2 |
| Audio to MIDI | Converts a source stem, then opens a piano roll with editing tools | Start with bass/melody transcription and downloadable MIDI | Later — Release 3 |
| Editing | Split, trim, crop, fade, reverse, move, time/pitch, automation | Keep only practice-relevant clip/range editing before growing toward DAW scope | Later / selective |
| Mix/master | Effects, genre Auto Mix, channel strips, mastering profiles | Practice-mix presets and limiter first; full effect chains are not core | Later / selective |
| Collaboration | Link sharing, permissions, live cursors, timestamped comments, version history | Teacher/bandmate annotations at a chord or timestamp; shared setlists | Later — Release 3 |
| Export | Mix, tracks/stems, chords, MIDI/MusicXML/project; multiple audio formats and rates | Export the audible custom mix as WAV or 256 kbps MP3; charts, session data, MIDI, and individual-stem bundles remain future work | Now — audio mix; more later |
| Music-service import | Link/media import exists on supported Moises surfaces | Open Spotify, Apple Music, TIDAL, or YouTube catalog searches without extracting protected streams; local file remains required for analysis/remixing | Now — catalog links only |
| Setlists | Rehearsal organization and collaboration | Saved per-song practice settings and ordered rehearsal sets | Next — Release 1 |
| Voice conversion | Searchable voices, filtering, previews, favorites, and reversible converted takes | The browse/preview/apply pattern is useful; voice conversion itself is not core | Defer |
| Sample generation | Prompt/context-based samples inserted into the project | Consider only after chord-aware backing parts prove useful | Defer |
| Live mode | A separate low-latency local/offline desktop workflow | Later split between quick rehearsal separation and higher-quality queued separation | Defer |

### Complete observed Studio surface

These capabilities are real parts of the current Studio story, but most should stay behind the chord/practice roadmap rather than determine its shape:

- multitrack audio and MIDI recording, visible record arm, nested take lanes, and comping;
- arrangement, chord, and lyric markers on the common ruler;
- split, loop, crop/trim, fades, repitching, reverse, automation, and version history;
- audio-to-MIDI feeding a piano roll, with a library of 200+ instrument sounds;
- VST3 support in the desktop product, Tone3000 access to a claimed 700,000+ tones, instrument presets, and compact effect tiles;
- 18 mix effects, genre-aware Auto Mix across 20 genres, and mastering profiles;
- voice conversion, searchable voices, filters, previews, favorites, and non-destructive converted takes;
- sample generation and “generate similar” clip actions;
- local-file, project-track, microphone, and (on supported product surfaces) link/media import;
- individual-track, altered-mix, chord, MIDI/MusicXML, project, DAWproject, and Ableton-oriented export flows;
- invite links, roles, live cursors, timestamped comments, offline edits that later synchronize, and version history;
- a newer natural-language production-assistant concept for actions such as comping, cleanup, and effects, described in the 2026 launch material.

The current [Studio product page](https://moises.ai/products/moises-studio/) is the common source for these breadth claims. They are useful as a long-term platform map, not a mandate to turn Chord Finder into a general-purpose DAW.

### Stem taxonomy

Official material is inconsistent on the exact count: the Studio page advertises **27 stem types**, while the September 2026 announcement says **30+ categories**. Older custom-upload help lists 23 choices. Counts likely vary by model, plan, and product surface, so Chord Finder should use capability metadata rather than hard-code a marketing number.

Useful categories visible across current and recent official flows include:

- vocals, lead vocal, backing vocals, male voice, and female voice;
- drums as a combined stem, or kick, snare, toms, hi-hat, cymbals, and other drums;
- bass;
- acoustic, electric, lead/solo, and rhythm guitar;
- piano and broader keyboard parts;
- strings, winds, percussion, and an “other” remainder;
- dialogue, soundtrack, and effects for multimedia material.

The older but still useful [custom separation guide](https://help.moises.ai/hc/en-us/articles/19247459645724-How-do-I-separate-my-tracks-using-the-Custom-Upload-on-the-Mobile-App) documents the detailed selection model. The current Studio page is the authority for the newer 27-type and Hi-Fi claims.

### Stem generation

Moises's [Stem Generation page](https://moises.ai/features/stem-generation/) and [AI Studio guide](https://help.moises.ai/hc/en-us/articles/21745204066076-Moises-AI-Studio-Your-All-in-One-AI-Music-Creation-Platform) establish a strong interaction model:

- begin with existing audio, MIDI, a riff, or even a hummed idea;
- choose drums, bass, guitar, keys, or strings;
- choose a visual style preset, AI Match/reference, or a custom prompt;
- condition the result on project tempo, key, chords, feel, and selected range;
- expose creative-follow strength and “Use Project Chords” as explicit controls;
- request audio or MIDI;
- generate only the selected region for a fill, transition, or variation;
- keep regenerations as non-destructive takes that can be soloed and compared.

For Chord Finder, “generate a backing track” is too broad. The first useful story is: **select Chorus 2, choose Bass → Soul pocket → Follow chords strongly → Generate MIDI**, then audition that take against the original or isolated stems.

### Instrumentalist practice features

Official Moises pages support the following practice backlog:

- Beginner/Intermediate/Advanced chord complexity plus manual correction: [Chord Finder](https://moises.ai/features/chord-finder/) and [Chord Detection guide](https://help.moises.ai/hc/en-us/articles/6569274648220-How-do-I-use-Chord-Detection).
- Large current/next chord, horizontal chord strip, measure/beat grid, lyrics with chords, and guitar shapes.
- Speed control that preserves pitch, pitch/key shifting, original-key reset, capo shapes, alternate notation, and tuning adjustment: [Pitch Changer](https://moises.ai/features/pitch-changer-shifter/), [Capo Mode](https://moises.ai/features/guitar-capo-mode/), and [tuning help](https://help.moises.ai/hc/en-us/articles/15757281113244-How-can-I-change-the-song-s-tuning).
- A tempo-following Smart Metronome with subdivision, volume, pan, reset, and musical tempo label: [Smart Metronome](https://moises.ai/features/metronome-online/). Because automatic BPM can be wrong, a manual beat-grid correction path is necessary; Moises itself documents this limitation in [BPM troubleshooting](https://help.moises.ai/hc/en-us/articles/16697903875484-The-BPM-is-wrong-what-should-I-do).
- Configurable count-in: [count-in help](https://help.moises.ai/hc/en-us/articles/6580752102044-How-do-I-set-up-the-count-in).
- Named sections, section navigation, and loops spanning adjacent sections: [Sections guide](https://help.moises.ai/hc/en-us/articles/10138829000988-How-do-I-use-Sections).
- AI lyric transcription: [Audio Transcription](https://moises.ai/features/ai-audio-transcription/).
- Video practice recording and collaborative setlists: [Video Recording](https://moises.ai/features/video-recording/) and [Collaborative Setlists](https://moises.ai/features/band-collaborative-setlist/).

## Product UI audit

### Desktop Studio

Current official videos and screenshots show:

- a dark, information-dense multitrack canvas rather than a collection of dashboard cards;
- a narrow primary tool rail at the far left, track controls beside the timeline, and contextual drawers on the right;
- transport, time, tempo, key, time signature, mix/master, and sharing in the top bar;
- Chords and Arrangement as first-class lanes above audio/MIDI tracks;
- track headers with visible level, mute, solo, pan, effects/routing, and overflow;
- colored waveform clips, a shared ruler, a precise playhead, range selection, and live collaborator cursors;
- contextual actions close to the selected track or range, while deeper separation/generation parameters live in a drawer;
- generated or converted results placed directly into the session, not stranded on a result page.

Useful current media:

- [Studio overview video](https://storage.googleapis.com/moises-cms-site/moises_studio_a28ab850d7/moises_studio_a28ab850d7.mp4)
- [Real-time collaboration flow](https://storage.googleapis.com/moises-cms-site/real_time_collaboration_motion_square_8752da3de3/real_time_collaboration_motion_square_8752da3de3.mp4)
- [Stem Separation flow](https://storage.googleapis.com/moises-cms-site/stem_separation_motion_square_f1eb4d786a/stem_separation_motion_square_f1eb4d786a.mp4)
- [Stem Generation flow](https://storage.googleapis.com/moises-cms-site/stem_generation_motion_square_8666891349/stem_generation_motion_square_8666891349.mp4)
- [Voice Conversion flow](https://storage.googleapis.com/moises-cms-site/voice_conversion_motion_square_303767a17b/voice_conversion_motion_square_303767a17b.mp4)
- [Instruments and Effects](https://storage.googleapis.com/moises-cms-site/instruments_and_effects_motion_square_335759c7de/instruments_and_effects_motion_square_335759c7de.mp4)
- [Mixing and Mastering](https://storage.googleapis.com/moises-cms-site/mixing_and_mastering_motion_square_b062fd42fb/mixing_and_mastering_motion_square_b062fd42fb.mp4)
- [Multitrack recording/take lanes](https://storage.googleapis.com/moises-cms-site/Multi_track_recording_c51ee8ae40/Multi_track_recording_c51ee8ae40.png)
- [Export modal](https://storage.googleapis.com/moises-cms-site/Easy_import_and_export_1f06d62339/Easy_import_and_export_1f06d62339.png)
- [Arrangement and chord/MIDI editing](https://storage.googleapis.com/moises-cms-site/Arrangement_and_markers_1926dcb62e/Arrangement_and_markers_1926dcb62e.png)
- [Clip editing and automation](https://storage.googleapis.com/moises-cms-site/Editing_and_automation_70caaa74d9/Editing_and_automation_70caaa74d9.png)
- [Sample Generation drawer](https://storage.googleapis.com/moises-cms-site/Sample_Generation_f8e7ef8987/Sample_Generation_f8e7ef8987.png)

### Mobile practice UI

The current [App Store listing](https://apps.apple.com/us/app/moises-the-musicians-app/id1515796612) shows the DAW collapsing into a practice-first layout:

- vertically stacked stem mixer strips with large sliders;
- persistent transport and current chord context;
- a bottom switcher for Lyrics, Chords, and Sections;
- a compact horizontal chord strip and a four-cell-per-measure beat grid;
- section chips aligned to progress, with the loop visible in both places;
- focused sheets for key shift, metronome, and backing-track presets.

Older first-party [Chord Detection help](https://help.moises.ai/hc/en-us/articles/6569274648220-How-do-I-use-Chord-Detection) additionally shows the large current/next chord with guitar-diagram mode and the simplified-chord/capo/notation settings sheet. Those images remain useful workflow evidence, but they are not presented here as the current App Store visual set.

Direct first-party snapshots: [stem mixer](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/b7/bc/8d/b7bc8d6e-672e-4474-679b-fae909ce0fa0/-01.png/1290x2796bb.webp), [backing-track presets](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/e3/b2/20/e3b2208d-4241-eabe-4d0b-7bf11def3cc8/-02.png/1290x2796bb.webp), [chord beat grid](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/0d/6e/d6/0d6ed6d4-9436-11ef-6eb1-7f3dc7c94656/-03.png/1290x2796bb.webp), [Smart Metronome](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/84/2b/1c/842b1c82-b706-369d-7a37-82305c53fa86/-04.png/1290x2796bb.webp), and [section looping](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/72/87/45/72874572-4d84-7a9c-25ad-049d0c7dafad/-08.png/1290x2796bb.webp).

Chord Finder should retain persistent playback state while switching views and use 40–44 px touch targets. It should improve on the reference UI with visible focus, text labels/tooltips, screen-reader progress for long jobs, high contrast, non-color stem identification, and reduced-motion support.

## Separation implementation decision

### Shipped local-preview engine

The implemented beta uses the browser build of
[`demucs-rs`](https://github.com/nikhilunni/demucs-rs) rather than the larger
four-source ONNX route considered earlier. Its WebGPU worker and WASM runtime
are vendored from release `v0.3.4`, whose tag resolves to commit
`97adfaae52e006be1557405bfc7b10614d805a78`, and recorded with exact hashes in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

On first use, the browser downloads the pinned `htdemucs_6s.safetensors`
checkpoint directly from Hugging Face. The app verifies the expected
54,890,960-byte file with SHA-256, caches it in IndexedDB, resamples the source
to stereo 44.1 kHz, and runs the job locally in a worker. It produces six
aligned WAV assets: drums, bass, other, vocals, guitar, and piano/keys. The
original is retained, stem creation is non-destructive, and the UI provides
phase progress and cancellation.

This is deliberately labeled a beta:

- it requires a secure context and WebGPU, currently targeted at desktop Chrome/Edge; there is no CPU/mobile fallback;
- inference is slow and memory-intensive, and the app rejects jobs whose conservative total-job estimate exceeds 1,200 MiB while suggesting a safe trim/split length (typically about 2½–3 minutes, because the WASM bridge temporarily retains two copies of the six-stem Float32 result);
- all source-separation models can produce bleed or artifacts, especially on dense arrangements and guitar/piano material;
- the hosting repository labels the checkpoint MIT, but that is not a sufficient chain-of-title statement for the weights. Production or commercial use requires independent rights clearance.

Alternatives researched remain useful: [`demucs-web`](https://github.com/timcsy/demucs-web)
provides a four-source ONNX path with an approximately 172 MB model, and the
official [ONNX Runtime Web documentation](https://onnxruntime.ai/docs/tutorials/web/)
describes its WebGPU/WASM execution tradeoffs. A future Cloud HQ engine should
still sit behind a provider-neutral job boundary with private temporary
storage, progress, cancellation, explicit retention/deletion rules, and no
provider secret in the browser.

## Streaming-provider boundary

Spotify, Apple Music, TIDAL, and YouTube offer licensed catalog and playback
surfaces, not general-purpose raw audio files that this static app may decode,
separate, transpose, and re-export. Relevant official surfaces include the
[Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk),
[MusicKit on the Web](https://developer.apple.com/musickit/), the
[TIDAL Web SDK](https://developer.tidal.com/documentation/web-sdk), and the
[YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference).

The shipped UI therefore performs catalog searches/deep links only. It does
not connect accounts, record a provider player, scrape media URLs, bypass DRM,
or represent protected streams as imported audio. Full analysis, separation,
transposition, and mix export require a local file the user is entitled to
process. A future provider integration may add authorized in-provider playback
or metadata, but that must remain visibly distinct from raw-audio import.

## Generation implementation decision

Generation needs a backend/provider boundary for the same reason: credentials, long-running jobs, storage, content policy, provenance, and cost cannot safely live in a static browser bundle.

The internal request should be musical rather than provider-specific:

```ts
interface GenerationRequest {
  instrument: "drums" | "bass" | "guitar" | "keys" | "strings";
  range: { startSec: number; endSec: number };
  tempoMapId: string;
  chordMapId?: string;
  sectionId?: string;
  stylePreset?: string;
  prompt?: string;
  referenceTrackId?: string;
  followStrength: number;
  useProjectChords: boolean;
  output: "audio" | "midi";
}
```

Every response should create a new take with its request, model, seed/provider identifier when available, and parent range. “Regenerate” means another take; it never means overwrite.

## Implementation completed in this pass

The repository now has a functional first slice of the practice-studio direction:

- real normalized waveform extraction in the existing analysis worker;
- a horizontally scrollable, duration-accurate timeline with ruler, waveform, chord blocks, playhead, confidence treatment, loop overlay, pointer seek, and keyboard seek;
- editable chord corrections that immediately update the timeline, playable piano/guitar/bass views, and capo-relative display;
- tonic-relative scale-degree numbers and movable-do solfa shown without replacing the detected chord symbol;
- an interactive Web Audio keyboard whose white and black keys remain playable while transport audio is running or paused;
- playback speed from 0.5× to 1.5× with pitch preservation;
- a song-key picker that transposes chord symbols, harmonic-function labels, live audio, and the exported mix as one session operation;
- A/B loop points and automatic loop playback;
- a beat-grid metronome with half-time, beat, and subdivision densities plus a 0–150% click-level control;
- capo-relative chord symbols while preserving the detected concert chord internally;
- a local stem mixer that imports multiple matching files, infers common stem names, links play/pause/seek/rate, actively corrects drift, and supports volume/mute/multi-solo/removal;
- six-source local WebGPU separation with pinned/integrity-checked model download, IndexedDB caching, progress, cancellation, memory guard, and aligned stem creation;
- stem-aware analysis on the original, guitar, keys, other, and bass sources while preserving the master beat grid; bass is intentionally root-only, while drums and isolated vocals remain mix/export sources rather than pretending they contain full chords;
- offline rendering of the audible mute/solo/volume state to WAV or 256 kbps MP3, including the active key transposition;
- duration mismatch/load warnings and automatic original-mix muting when stems are first imported;
- catalog search links for Spotify, Apple Music, TIDAL, and YouTube with an explicit no-stream-extraction boundary;
- musician-friendly keyboard shortcuts: Space, Left/Right, L, and M;
- stale-analysis protection so cancelling or opening another song cannot let an older asynchronous result overwrite the new session;
- a responsive dark session layout with a vertically centered keyboard, previous/current/next progression context, semantic contrast, visible focus, reduced-motion handling, and large primary targets.

Current limitations: imported stems must already be aligned to the source, and
the independent media elements are actively synchronized rather than driven by
a sample-accurate multitrack timeline. Live key shifting depends on the
SoundTouch AudioWorklet and falls back to native playback if that audio graph
cannot initialize. Automatic separation has no CPU/mobile fallback, carries
the model-rights warning above, and still needs broader device and musical-
quality benchmarking. Section detection, persistence, chart/session export,
recording, generation, and browser-level integration coverage remain future
work; the core theory, bass-root, WAV, and memory-budget paths have unit tests.

## Build order

### Release 1 — dependable practice session

- Persist corrected chords, capo, speed, loops, mixer levels, and imported-stem metadata in IndexedDB.
- Add editable beat anchors and time signature so the Smart Metronome can be corrected.
- Add Roman-notation and easy/standard/extended chord modes to the shipped piano/guitar/bass views.
- Add named sections and section loops.
- Add session JSON and printable chord-chart export.
- Add browser-level unit/integration tests for playback, looping, corrections, key shifting, mixer synchronization, and export.

### Release 2 — harden separation and performance feedback

- Benchmark the local six-source beta across supported GPUs, song lengths, and instrument-heavy evaluation material.
- Add cache management, retry, quality labeling, device diagnostics, and a CPU/server fallback decision.
- Add quick instrument-oriented presets, a provider-neutral Advanced taxonomy, grouped output provenance, and one optional HQ backend.
- Add count-in and simple microphone/instrument recording with take lanes.
- Add practice history: tempo reached, loop repetitions, last position, and notes.
- Add individual-stem/bundle export and optional pan controls.

### Release 3 — chord-aware creation

- Add section-scoped bass/drum/guitar/keys generation behind the provider interface.
- Add preset, prompt/reference, follow-strength, and Use Project Chords controls.
- Add non-destructive variants, A/B audition, and take promotion.
- Add audio-to-MIDI for isolated bass/melody, then MIDI export and a lightweight note editor.
- Add timestamped teacher/bandmate comments and shared setlists.
- Add MusicXML/PDF charts and portable project bundles.

## Product guardrails

- Do not describe a result as “local” if a separation or generation provider uploads it.
- Show file retention/deletion rules before upload and provide deletion controls.
- Keep provider API keys server-side.
- Keep the original source and every user correction; AI operations are reversible children of them.
- Surface model/version provenance and distinguish preview from high-quality processing.
- Do not enable the current HTDemucs checkpoint in production or commercial distribution without independent model-rights clearance.
- Keep streaming-service catalog/playback integrations separate from raw-audio import; do not record, scrape, or bypass protected playback.
- Do not promise a fixed stem-category count; query the engine's supported capabilities.
- Treat generated accompaniment as a new take with rights/provenance metadata.
- Make detected BPM, chords, sections, and tuning correctable. They are hypotheses, not truth.
- Build an original Chord Finder visual identity. Reuse information architecture patterns, not Moises brand assets or distinctive trade dress.

## Additional official references

- [How to upload and edit a track](https://help.moises.ai/hc/en-us/articles/8583454469276-How-to-Upload-and-Edit-your-track-using-Moises)
- [Change separation without re-uploading](https://help.moises.ai/hc/en-us/articles/6564889454236-How-can-I-change-my-song-s-track-separation-without-re-uploading)
- [Export files and altered mixes](https://help.moises.ai/hc/en-us/articles/360013691720-How-do-I-export-my-file)
- [Chord grid mode](https://help.moises.ai/hc/en-us/articles/9570133423772-How-to-use-the-new-Chords-view-Grid-Mode)
- [Keyboard shortcuts](https://help.moises.ai/hc/en-us/articles/6570210715932-Keyboard-Shortcuts)
- [Cross-platform differences](https://help.moises.ai/hc/en-us/articles/12156312650012-Is-Moises-different-across-platforms-and-devices)
- [Moises Live](https://moises.ai/products/live/)
- [DAW integrations](https://moises.ai/products/integrations/)
- [Recent product improvements](https://moises.ai/blog/latest/improvements-latest-releases/)

All Moises claims above are based on first-party product, newsroom, help-center, App Store, image, or video material. Repository recommendations and feasibility conclusions are explicitly Chord Finder design/engineering judgments.
