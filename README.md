# Tonalia

**Nondestructive spectral audio editing, developed by Fatty Recording Co.**

[Tonalia website](https://fattyrecordingco.github.io/Tonalia/) · [Illustrated user guide](https://fattyrecordingco.github.io/Tonalia/guide/) · [Browser editor](https://fattyrecordingco.github.io/Tonalia/app/)

The current source is Tonalia 0.4.1, with a shared Rust audio core, a React/TypeScript workspace, desktop packages for Windows/macOS/Linux, and a browser client using the same DSP through WebAssembly. It is an incremental implementation of the [master plan](docs/planning/README.md), not a completed Audition replacement.

Version 0.4.1 adds automatic sound discovery and extraction, analysis-driven suggestions, joint spectral cleanup, **Separate sounds**, noise-profile reduction, improved brushes, WAV drag and drop, vertical frequency navigation, and Removed-signal export. Dense brushes now evaluate only their supported FFT bins, and playback recovers brief queue gaps without skipping source samples. AI separation is desktop-only and uses optional local packs; the other editing additions also work in the browser.

## Download the desktop app

Installers are published on the [Tonalia 0.4.1 release page](https://github.com/fattyrecordingco/Tonalia/releases/tag/v0.4.1). No developer tools or account are needed. Editing works offline after installation.

| Your computer | Direct installer |
| --- | --- |
| Windows 11 x64, Intel/AMD | [Windows setup.exe](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.4.1/Tonalia_0.4.1_windows_x64_setup.exe) |
| Mac Apple Silicon, macOS 13+ | [Apple Silicon DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.4.1/Tonalia_0.4.1_macos_apple_silicon.dmg) |
| Mac Intel, macOS 13+ | [Intel DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.4.1/Tonalia_0.4.1_macos_intel.dmg) |
| Ubuntu 22.04+/compatible Debian, x86-64 | [Linux .deb](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.4.1/Tonalia_0.4.1_linux_amd64.deb) |
| Other compatible Linux desktops, x86-64 | [Linux AppImage](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.4.1/Tonalia_0.4.1_linux_x86_64.AppImage) |

See [installation, chip selection, offline use and checksum instructions](docs/INSTALL.md). These are development builds: Windows is unsigned and Mac builds are ad-hoc signed without Apple notarization. The Windows setup includes the WebView2 offline installer. Linux prerequisites must be available locally for a fully offline installation.

The release workflow checks the shared DSP and browser editor, installs each native package, and runs packaged analysis/restoration diagnostics before publishing. See the [0.4.1 verification record](docs/implementation/RELEASE-0.4.1.md) and [distribution history](docs/implementation/DISTRIBUTION.md) for scope and evidence.

## What works

- Open mono/stereo RIFF WAV or RF64: PCM 8/16/24/32-bit and IEEE float 32/64-bit, at 8–192 kHz. Preserve the source's samples, channels, and sample rate.
- Inspect a calibrated Hann-windowed spectrogram, log/linear frequency axes, source waveform, overview, numerical spectrum, peak/RMS/DC statistics, and stereo correlation.
- Navigate with overview, pan, pointer-anchored zoom, and fit commands. Viewport analysis streams bounded ranges instead of loading a whole recording into a JavaScript audio buffer.
- Select time/frequency rectangles, freeform lassos, and weighted brush strokes. Set numeric bounds, channel scope, and supported feathering.
- Apply actual spectral gain or attenuation as ordered, reversible layers. Enable/bypass, reorder, name, remove, undo and redo layers.
- Listen to the original, processed result, or removed signal. Desktop sources use native CPAL output; the browser uses streamed AudioWorklet output.
- Export the layer stack at the original rate and channel layout as 32/64-bit float WAV, with RF64 headers for large outputs. Desktop writes a temporary output and finalizes it only when complete; it refuses to overwrite the source path.
- Save project manifests with source SHA-256 identity. Reopening requires the matching original WAV before restoring edits. Projects do not embed media.
- Render the spectral raster with WebGL2 and fall back to Canvas2D if graphics are unavailable/lost. GPU availability cannot change the DSP result.

- Use spectral gating, harmonic hum attenuation, short-click interpolation and the bundled offline neural speech model as reversible restoration layers.
- Capture a noise-only passage and apply per-channel noise-profile reduction, with sensitivity and maximum attenuation controls. The captured profile is saved in the reversible layer.
- Export **Result**, **Removed**, or **Original**. Removed exports the same original-minus-result signal heard in the monitor, so you can save the cleaned recording and the isolated spectral-layer difference separately.
- In the desktop **Separate sounds** workspace, run optional local AI packs for automatic source detection and extraction, six music stems, up to eight described sounds, and brief-transient spectral extraction. Suggestions come from measured detector outputs; joint spectral cleanup reduces bleed. Preview, edit and export the generated tracks. [Setup, model credits, and limits](tools/audio-ai/README.md).
- Drop a WAV directly into the browser or desktop editor. Use the visible Hz zoom/pan controls or exact display-frequency bounds for precise spectral work.
- Recover recent local layer checkpoints from History. Use the Shortcuts guide and mouse/trackpad zoom to navigate.
- Host or join an optional LAN editing session with source identity checks, ordered revisions and explicit conflict rejection. Audio remains local.

All audio processing is local. There is no account requirement or audio upload service. [Current release and verification](docs/implementation/RELEASE-0.4.1.md) · [Earlier DSP algorithms](docs/implementation/RELEASE-0.2.md).

## Run from source

Use the **Windows** versions of Node and Rust when building on Windows. Avoid mixing a Windows `node_modules` directory with a Linux Node runtime.

Requirements:

- Node.js 22.12+ or 24 LTS; the current lockfile was tested with Node 24.
- Rust 1.94.0 with `wasm32-unknown-unknown`, `rustfmt`, and `clippy` (see `rust-toolchain.toml`).
- For Windows desktop: Visual Studio C++ Build Tools, a Windows SDK, and WebView2. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run engine:build
npm run dev
```

Open **http://127.0.0.1:1420**. Choose **Open WAV**, or **Explore a calibration session** to inspect an explicitly generated signal with harmonics, a whistle, a click, and a chirp.
You can also drag a `.wav` or `.wave` file directly onto the editor, including in the desktop app.

```sh
# Native desktop development
npm run desktop:dev

# Browser production assets
npm run build

# Windows application and NSIS installer
npm run desktop:build
```

The Windows installer is written to `target/release/bundle/nsis/Tonalia_0.4.1_x64-setup.exe`. The standalone application is `target/release/tonalia-desktop.exe`; it also accepts a WAV path as its first command-line argument. Platform configurations build Windows NSIS, macOS DMG, and Linux Debian/AppImage packages. The release workflow builds separate Apple Silicon and Intel packages on native Mac runners. See [installation instructions](docs/INSTALL.md) for supported baselines and signing limits.

## Make a reversible edit

1. Open a WAV. Allow the source scan to finish before saving a project.
2. Draw a rectangle/lasso/brush selection, or type time and Hz bounds in the inspector.
3. Choose linked channels or an individual channel, set gain, and select **Create gain layer**.
4. Compare **Original**, **Result**, and **Removed**. Enable/bypass layers to compare treatments.
5. Save the project to retain the editable stack; export audio to render a new WAV.

Processing order is bottom to top in the layer panel. **Removed** means original minus the final processed result; it can include phase-dependent differences. Monitor volume is independent of exported gain. Processing uses a fixed 2048-point periodic Hann STFT with 512-sample hop. The display FFT is independent of the processing FFT.

A brush persists physical sample/Hz coordinates, opacity and adjustable hardness. New strokes are continuous, so fast movements leave no gaps and overlapping pointer events do not increase opacity. A live outline shows the brush footprint, with diameters down to 2 px; `[` and `]` resize it. Legacy saved brush strokes retain their original dab accumulation. The separate feather controls apply to rectangles/lassos; the brush has its own edge falloff. Setting numeric selection bounds on a freeform selection converts it into a rectangle. A mask is a region to process, not a guaranteed isolated sound source.

For noise reduction, select a noise-only passage (at least 2048 samples, at most 10 seconds), open **Restore → Noise reduction (captured profile)** and choose **Capture noise profile**. Select the region to clean, or choose **Select entire recording**, adjust sensitivity/reduction and create a restoration layer. Compare **Result** and **Removed** before exporting. Profiles are learned from the original audio, separately for each channel, using the fixed processing FFT. This works best on steady noise; it is not adaptive noise tracking.

The **Time** and **Hz** buttons above the spectrum zoom each axis independently. Hz arrows pan vertically; **Fit frequency range** restores the full band. **View low frequency** and **View high frequency** in Display accept exact Hz limits. **Fit source** resets both axes, and **Zoom to selection** fits both time and frequency.
After zooming vertically, drag the frequency slider at the right edge or scroll over the Hz ruler to move up and down. Alt/Option + wheel zooms frequency; Alt/Option + Shift + wheel pans it. Display analysis supports up to 16,384 FFT samples and reports Hz per bin; the processing FFT remains fixed at 2048 samples.

To export the selected spectral material, attenuate it with a layer, then choose **Removed** in the monitor and **Export audio**. The export dialog defaults to the monitored signal; its **Signal** menu can also select **Result** or **Original**. Removed includes the differences from all enabled layers, with their gains, masks and feathering. Bypass other layers to export the effect of one layer. With finite attenuation this is the attenuated difference, rather than a binary cutout of the whole drawn region. Export Result separately to retain the cleaned recording. At 64-bit precision, Result plus Removed reconstructs the decoded original to floating-point precision.

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Play/pause | Space |
| Time / rectangle / lasso / brush / pan | T / M / L / B / H |
| Brush size | `[` / `]` |
| Fit source / selection | Shift+1 / Shift+2 |
| Zoom at pointer | Ctrl/Cmd + wheel |
| Time pan | Wheel / trackpad; middle-button drag; H then drag |
| Frequency zoom | Alt/Option + wheel |
| Frequency pan | Alt/Option + Shift + wheel; hand-tool vertical drag; Hz arrows |
| Direct vertical scrolling | Wheel on the Hz ruler; right-edge frequency slider |
| Undo / redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Save project | Ctrl/Cmd+S |
| Create/update gain layer | Ctrl/Cmd+Enter |
| Clear/cancel selection | Escape |

## Verify

```sh
cargo test -p tonalia-core
cargo fmt --all --check
npm run typecheck
npm run format:check
npm run test:e2e
```

Browser tests use installed Chrome locally; CI installs Playwright Chromium. They verify an actual exported spectral edit and unchanged channels/source, source measurements, project fingerprint/relink, display-independent output, selection tools, GPU loss, and AudioWorklet transport. The separate Windows native smoke test uses the packaged WebView and native IPC/output/export:

```sh
npm run desktop:build
node tests/native/smoke.mjs
```

The native smoke test opens a temporary generated recording, plays a short quiet preview through the default device, checks a native export/project, and closes its own app instance. By default it uses command-line open and direct export/project IPC. Set `TONALIA_TEST_PICKERS=1` on Windows to exercise the actual native Open WAV, Export WAV and Save Project dialogs; this mode briefly focuses the test application's dialogs. Set `TONALIA_TEST_EXECUTABLE` to the installed executable and `TONALIA_TEST_OFFLINE=1` to block outbound WebView internet while preserving local IPC. It uses an isolated temporary WebView profile/debugging port for the test process. See [distribution verification](docs/implementation/DISTRIBUTION.md) and [implementation status](docs/implementation/STATUS.md).

## Current limits

This release is not professional feature parity. Adaptive noise tracking, advanced spectral inpainting, declipping, dereverberation, LUFS/true-peak metering, hosted collaboration/CRDT merging, additional AI restoration models, recording, third-party plugin hosting, and device selection remain outstanding. Initial restoration and LAN sessions have the limits documented for 0.2.

The renderer and transport operate on snapshots; changing a layer or monitor mode stops playback, and the new graph is heard on the next play. Long-view spectrograms sample STFT frames rather than computing every intervening frame; zoom in for transient inspection. Spectrum readings describe a frame, not a full-selection frequency average. Source statistics describe the original, not the processed output.

The whole-source waveform is a peak-bin overview; a short viewport also receives finer source peaks down to individual samples. There is no disk spectral cache yet. Production latency, large-file throughput, long-session reliability, accessibility studies, and Audition comparison gates remain unqualified.

Projects are explicit schema 2 JSON snapshots with up to 64 processing layers and 100 in-memory undo states. Schema 1 gain projects remain readable. History keeps up to 20 local recovery checkpoints; it is not an embedded audio backup or durable crash-recovery journal. Keep the original WAV and save edits before closing. Browser export streams directly to a chosen file where supported; its Blob-download fallback is capped at 256 MiB. Native export is the intended long-file path; >4 GiB physical-file qualification is outstanding even though RF64 header tests pass.

Only float WAV export is currently exposed. Float preserves headroom; choose 64-bit float when decoded 32-bit integer precision matters. Monitoring uses f32 and a bounded windowed-sinc converter when device and source rates differ. That converter is not qualified for final-delivery rate conversion. No source-rate conversion is performed on export. Unknown/nonfinite audio is rejected; imported float magnitude is limited to +120 dBFS. Source metadata chunks are not retained in new exports.

## Source layout

- `crates/tonalia-core`: WAV/RF64, f64 STFT/masks/gain, statistics, monitor conversion and numerical tests.
- `crates/tonalia-wasm`: generated JS/WASM bindings to the same core.
- `src-tauri`: native read-only media access, CPAL playback, project I/O, atomic export and desktop packaging.
- `apps/web`: React controls, worker scheduling, AudioWorklet streaming and GPU/CPU display.
- `tests`: browser integration and packaged Windows smoke tests.
- `tools/audio-ai`: optional local ONNX model worker, pinned model identities, licenses and inference tests.
- `docs/planning`: research, original specifications and the staged roadmap.

MIT licensed; see [LICENSE](LICENSE) and [dependency notes](docs/implementation/DEPENDENCIES.md). No code or artwork was copied from Adobe or Figma, or extracted from the other Fatty Recording Co repositories.

## How it is built

Tonalia combines a React/TypeScript interface with a shared Rust audio engine, compiled to WebAssembly for the browser and packaged with Tauri on desktop. Spectral editing uses Hann-windowed short-time Fourier transforms, sample/Hz selection masks and reversible processing layers. Original audio remains read-only; export renders a new file. GPU rendering accelerates the display independently of audio processing.

Recent editing, restoration, separation and export features were developed with Codex assistance for implementation and testing. The source code, numerical contracts and browser/native checks provide inspectable evidence of behavior. The optional separation workspace uses named pretrained models through a local Python/ONNX runtime; those models were not trained from scratch for Tonalia. Detection and separation outputs remain estimates that need listening and inspection.

Faculty feedback motivated separate Removed-signal export, direct vertical scrolling and clearer display resolution. These additions address that workflow; they do not establish general Audition parity or guarantee suitability for every assessment requirement.
