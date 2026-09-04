# Third-party notices

This file records the third-party components that are especially relevant to
Chord Finder's audio processing and distribution. It is a provenance record,
not legal advice and not a replacement for the license text shipped by each
dependency.

## Application source and license

The source corresponding to the public Chord Finder build is available at
[`thecreativezik/chord-finder-web`](https://github.com/thecreativezik/chord-finder-web).
The project license and the complete license texts distributed with the web
build are available from its in-app **Source & licenses** page.

## demucs-rs browser runtime

Chord Finder vendors two compiled browser artifacts from
[`nikhilunni/demucs-rs`](https://github.com/nikhilunni/demucs-rs), whose source
is licensed under Apache-2.0:

- Upstream tag commit: `97adfaae52e006be1557405bfc7b10614d805a78`
- Upstream release: [`v0.3.4`](https://github.com/nikhilunni/demucs-rs/releases/tag/v0.3.4)
- `public/vendor/demucs/worker.js` — 25,354 bytes — SHA-256
  `36ce753b67c5a41ec1342b2ec82c11d1989c64da24dee8c6c25b2047a02a71d8`
- `public/vendor/demucs/demucs_wasm_bg.wasm` — 12,319,325 bytes — SHA-256
  `bdcc53b41151d59e33b7872922d632efc353fbe1fbaa4159da11b77e0def1453`

Copyright and patent terms remain with the upstream authors and contributors.
See the [upstream Apache-2.0 license](https://github.com/nikhilunni/demucs-rs/blob/97adfaae52e006be1557405bfc7b10614d805a78/LICENSE).

## HTDemucs six-source model

The model is **not included in this repository**. When a user starts automatic
separation, their browser downloads this pinned checkpoint directly from
Hugging Face and processes the user's audio locally:

- Repository: [`set-soft/audio_separation`](https://huggingface.co/set-soft/audio_separation)
- Revision: `939723568b2dca203e61cc7294317ba38549964f`
- File: [`Demucs/htdemucs_6s.safetensors`](https://huggingface.co/set-soft/audio_separation/blob/939723568b2dca203e61cc7294317ba38549964f/Demucs/htdemucs_6s.safetensors)
- Size: 54,890,960 bytes
- SHA-256: `f56fe666f0bbf3a645764856ed90f8c5dd8cf4430b1d9649b94e29ec45aa9057`

The hosting repository currently carries an MIT label, but that label is not,
by itself, a complete chain-of-title statement for the pretrained checkpoint.
Chord Finder therefore makes no representation that the model weights are
cleared for redistribution, commercial use, or every intended deployment.
Obtain independent permission and legal clearance before enabling this model
in a production or commercial distribution. Removing the model from this
repository does not remove that responsibility from an operator who causes it
to be downloaded at runtime.

## SoundTouchJS AudioWorklet

[`@soundtouchjs/audio-worklet`](https://github.com/cutterbl/SoundTouchJS),
currently version 2.1.1, is used for pitch-preserving playback speed and
real-time/offline key transposition. It is licensed under MPL-2.0. See its
[license](https://github.com/cutterbl/SoundTouchJS/blob/master/LICENSE).

## lamejs

[`@breezystack/lamejs`](https://github.com/shijinyu/lamejs), currently version
1.2.7, provides MP3 encoding and is licensed under LGPL-3.0. It is bundled as a
separate package dependency; modifications to it remain subject to the LGPL.
See the [packaged license and source](https://github.com/shijinyu/lamejs).

## Essentia.js

[`essentia.js`](https://github.com/MTG/essentia.js), currently version 0.1.3,
provides musical feature extraction and is licensed under AGPL-3.0. This
copyleft dependency affects distribution and hosted use of the application;
see the [upstream license](https://github.com/MTG/essentia.js/blob/dev/LICENSE).

The remaining JavaScript dependencies and their declared licenses are recorded
in `package-lock.json` and in each installed package's license files.
