# Tonalia 0.4.1 candidate (withheld)

This candidate includes the editing and local source-separation additions in [release notes](../RELEASE-NOTES.md). The core editor is shared between desktop and browser through Rust/WebAssembly. Optional separation is desktop-only; model identities, attribution and inference limits are documented in [audio intelligence](../../tools/audio-ai/README.md).

## Brush deadline correction

The previous brush path visited every stroke primitive for every bin, channel and frame. Dense strokes could delay rendering past the audio queue's deadline while the processed spectrogram was also analysing the graph. The renderer now computes a frame's mask once, culls primitives outside its time support, visits only supported frequency bins, shares weights across channels and skips zero-mask frames. Continuous-stroke distance, opacity, hardness, legacy dab accumulation and saved geometry are unchanged.

The native output queue holds two seconds of device-rate frames and prepares at least half a second before playback. Its callback remains free of rendering, allocations and locks. Native and browser callbacks emit silence during brief starvation, retain the source position and resume from the next unplayed sample. A sustained two-second starvation or an actual device/render failure still stops playback. This reduces interruptions; it does not qualify every audio device or guarantee zero dropouts under arbitrary load.

## Reproducible checks

- `cargo test -p tonalia-core`: numerical signal, WAV/RF64, mask, restoration, streaming and source-preservation contracts. An additional test compares accelerated masks with the scalar reference across every FFT bin for continuous and legacy brushes.
- `cargo test -p tonalia-desktop`: native cache/source identity, LAN protocol and short/sustained queue starvation.
- `npm run test:audio`: actual AudioWorklet code in an isolated runtime; brief starvation resumes the same samples and only sustained starvation signals failure.
- `npm run test:e2e`: browser selection, vertical navigation, brush controls, WAV drop, noise profile, Removed export, recovery, restoration and sharing boundaries.
- `npm run test:brush:native`: packaged Windows app, seven 512-point brush layers, +11.5 dB, 44.1 kHz stereo, real-device Result/Removed playback during processed-spectrogram analysis. Uses a generated recording and temporary app profile.
- `node tests/native/auto-separation.mjs`: real PANNs/AudioSep detection/extraction, confidence abstention, previews, track export and residual reconstruction through the packaged UI. Uses a public upstream telephone/speech reference.
- `node tests/native/separation.mjs`: music stems, transient detection, native cancellation, preview, export and opening a track for editing.
- `python tools/audio-ai/test_worker.py`: transient, rate/layout, spectral cleanup and reconstruction contracts; optional actual-model checks require downloaded packs and the reference fixture.
- `npm run test:website`: download mappings, guide search, screenshots, responsive/no-JavaScript use and editing through the public browser path.

The synthetic release-mode brush benchmark (`cargo run --release -p tonalia-core --example brush_benchmark`) renders 65,536 stereo frames with seven 512-point strokes. On the same Windows machine, the scalar path took **14.976 s**, and the optimized path took **0.0804 s** to render **1.486 s** of audio (about **186× faster** for this case). This focused benchmark does not measure general application latency.

## Owner-machine results

On Windows, 25 core and five desktop Rust tests, the AudioWorklet recovery test, 17 editor integration tests, 25 website/Pages-path checks and 11 Python contracts with the real downloaded models passed. Packaged-app checks passed for seven dense brushes in Result and Removed, native playback/export, Removed reconstruction, source overwrite protection, restoration, two-process co-editing, music/transient separation and automatic detection/extraction. Automatic separated-track reconstruction had a maximum error of 2.104e-8; native 64-bit Result plus Removed reconstructed with zero measured error on the reference fixture. These checks use synthetic/public reference recordings and do not establish universal source-separation quality. See [machine-readable results](checks-0.4.1.json).

## Distribution

The tagged release workflow builds and installs Windows x64, Apple Silicon, Intel Mac, Linux Debian and AppImage packages. Published installer hashes, sizes, exact source commit and workflow URL are recorded in [build-artifacts.json](build-artifacts.json); per-platform installed-app diagnostic reports accompany the release. [Distribution history](DISTRIBUTION.md) retains earlier qualification separately. The 0.4.1 candidate was withheld after the Mac installed-app readiness check failed. See [0.4.2](RELEASE-0.4.2.md) for the startup verification correction and published packages.

No private audio, user project backups, model weights or generated separation audio are included in source control or release downloads. Optional models download from pinned upstream locations during explicit pack setup.
