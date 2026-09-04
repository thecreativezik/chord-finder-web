# Chord Finder (Web)

Detect the **key, tempo, and full chord progression** of a song, then turn it
into an instrument practice session. Drop in an audio file, transpose it,
audition chords on the playable keyboard, isolate instruments, and export a
custom backing mix. The source audio is processed on the user's device rather
than uploaded to a Chord Finder server.

This is the web port of the Chord Finder macOS app. The analysis engine —
essentia.js feature extraction, tuning estimation, spectral whitening, and a
Viterbi chord decoder over a 192-chord template bank — is shared **verbatim**
with the macOS app and measured by the same benchmark (about 99% clean and
97–98% hard-mix accuracy in recent runs; run `npm run eval`).

## Practice workspace

- Duration-accurate waveform and chord timeline with seeking and editable chord corrections
- Nashville-style root numbers and movable-do solfa shown alongside the original chord symbol
- Clickable piano, guitar-fretboard, and bass-fretboard views, plus previous/current/next context
- Pitch-preserving playback speed, whole-session key transposition, A/B looping, and a beat-aware metronome with 0–150% click volume
- Capo-relative chord symbols while retaining concert-pitch chords
- Local multi-stem import with linked play/pause/seek/rate, active drift correction, volume, mute, and multi-solo
- Stem-aware analysis: full harmony from the mix/guitar/keys/other and honest root-only reading from bass
- WAV or 256 kbps MP3 export of the currently audible mix, including the selected key change
- Six-source local separation beta for drums, bass, vocals, guitar, piano/keys, and other

The source-backed [Moises product teardown and roadmap](./report-source.md)
documents the product research, the implemented separation decision, and the
larger direction for sections, recording, generation, and collaboration.

## Automatic separation beta

Automatic separation uses a vendored `demucs-rs` WebGPU/WASM runtime and a
pinned HTDemucs six-source checkpoint. It requires a secure context and WebGPU,
so use a current desktop Chrome or Edge build. The first run downloads and
integrity-checks a 54,890,960-byte model (about 52 MiB), then caches it in
IndexedDB. Audio remains local, but processing can be slow and memory-intensive.
The app refuses jobs whose conservative total-job estimate exceeds 1,200 MiB,
suggests a safe trim/split length, and keeps inference and stem encoding cancellable.
The estimate includes the temporary second six-stem Float32 copy retained by the
WASM bridge; depending on upload size, the suggested section limit is typically
about 2½–3 minutes.

The checkpoint is fetched at runtime rather than stored in this repository.
Its hosting page carries an MIT label, but the checkpoint's rights provenance
is not sufficiently clear for this project to claim production or commercial
clearance. See [Third-party notices](./THIRD_PARTY_NOTICES.md) before deploying
the separator.

## Music services

The Spotify, Apple Music, TIDAL, and YouTube choices are catalog search links,
not account connections or audio imports. Those services do not expose their
licensed raw streams for arbitrary chord analysis, separation, transposition,
or remix export. Chord Finder never records or extracts those streams; use a
local audio file that you are entitled to process for the full workflow.

## Stack

- React 19 + Vite + Tailwind CSS v4 — static SPA, no backend
- [essentia.js](https://mtg.github.io/essentia.js/) (WASM) in a Web Worker
- [tonal](https://github.com/tonaljs/tonal) for music theory
- [SoundTouchJS AudioWorklet](https://github.com/cutterbl/SoundTouchJS) for pitch-preserving playback and key changes
- [`demucs-rs`](https://github.com/nikhilunni/demucs-rs) WebGPU/WASM runtime for local separation
- [`@breezystack/lamejs`](https://github.com/shijinyu/lamejs) for MP3 export

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm test           # focused theory, bass-root, WAV, and separation-budget tests
npm run eval       # chord-engine accuracy benchmark (Node)
EVAL_HARD=1 npm run eval   # benchmark against a dense, noisy mix
```

## Browser support

Input decoding follows the browser's audio codec support. OGG is not available
in Safari, and AIFF is not available in Chrome/Firefox; the app reports a
format-specific error when decoding fails. The practice, analysis, import, and
export tools work without WebGPU. Only automatic separation requires WebGPU
and is currently aimed at desktop Chrome/Edge.

## License

This project depends on essentia.js, which is licensed under **AGPL-3.0**.
Distributing this app (including hosting it publicly) requires the source to be
available under AGPL-3.0 terms. SoundTouchJS is MPL-2.0 and the MP3 encoder is
LGPL-3.0. Exact versions, vendored runtime hashes, model provenance, and the
model-clearance warning are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
Production builds copy the notices and complete license texts into `/legal/`,
which is linked from the application header.
