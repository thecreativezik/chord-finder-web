# Chord Finder (Web)

Detect the **key, tempo, and full chord progression** of any song — entirely in
your browser. Drop in an audio file and read the chords on a chart-style piano
keyboard that follows playback. Nothing is uploaded; all analysis runs
client-side on WebAssembly.

This is the web port of the Chord Finder macOS app. The analysis engine —
essentia.js feature extraction, tuning estimation, spectral whitening, and a
Viterbi chord decoder over a 190-chord template bank — is shared **verbatim**
with the macOS app and verified by the same benchmark (99% clean / ~96.5%
hard-mix accuracy; run `npm run eval`).

## Stack

- React 19 + Vite + Tailwind CSS v4 — static SPA, no backend
- [essentia.js](https://mtg.github.io/essentia.js/) (WASM) in a Web Worker
- [tonal](https://github.com/tonaljs/tonal) for music theory

## Develop

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm run eval       # chord-engine accuracy benchmark (Node)
EVAL_HARD=1 npm run eval   # benchmark against a dense, noisy mix
```

## Browser support

MP3, WAV, M4A/AAC, and FLAC decode in all modern browsers. OGG doesn't decode
in Safari; AIFF doesn't decode in Chrome/Firefox. The app reports which formats
the current browser supports when a decode fails.

## License

This project depends on essentia.js, which is licensed under **AGPL-3.0**.
Distributing this app (including hosting it publicly) requires the source to be
available under AGPL-3.0 terms.
