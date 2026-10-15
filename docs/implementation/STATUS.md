# Current release status

**0.2.0 development release.** Navigation, initial restoration, offline neural denoising, local recovery and optional LAN sessions are implemented. See [0.2 behavior, algorithms, test coverage and remaining work](RELEASE-0.2.md). No complete roadmap phase or Audition parity is asserted. Installer publication and installed verification are recorded in release reports.

Local pre-release validation: **22 core numerical tests passed** (17 existing + 5 restoration), **3 native tests passed** (LAN protocol and render-cache contracts), **12 browser integration tests passed**. The browser suite covers offline neural rendering and recovery across reload. The Windows native workflow also passed actual CPAL playback, native gate/neural export, exact untouched-channel preservation, source protection, LAN acknowledgment/conflict/source-token checks and an accepted peer edit visible in the UI with external WebView internet blocked. The published Windows installer, Debian package and FUSE AppImage subsequently passed owner-machine offline checks. Native Windows Open/Export/Save dialogs and two installed Windows co-editing processes passed; all five public installer links returned HTTP 200 without authentication. See [0.2 distribution evidence](DISTRIBUTION.md#02-release-update).

The record below documents the earlier 0.1 baseline; its counts and limits are historical.

---

# Tonalia 0.1 implementation status

**Development release — 15 October 2026.** Implementation was authorized after the research package. This release provides actual local spectral gain editing, native playback and file export. The original [roadmap](../planning/07-roadmap-and-backlog.md) remains the specification for the larger product; no phase or Audition parity gate is declared complete by this release.

**Distribution update:** [0.1.0 is published](https://github.com/fattyrecordingco/Tonalia/releases/tag/v0.1.0) for Windows x64, Mac Apple Silicon/Intel, and Linux Debian/AppImage. All native packaging and installed-app checks passed. The published Windows and Linux downloads were also installed and tested offline on the owner machine (Linux under WSL2). See [distribution evidence and limitations](DISTRIBUTION.md) and [download instructions](../INSTALL.md). The tables below retain the original engine/editor verification scope.

## Delivered behavior

| Area | Implemented | Current boundary |
| --- | --- | --- |
| Audio core | Shared Rust library compiled natively and to WebAssembly; f64 decoding and spectral processing | Mono/stereo WAV/RF64, 8–192 kHz; no compressed formats, recording or multitrack mixing |
| Spectral viewer | Calibrated periodic-Hann analysis, per-channel spectrogram/waveform, physical time/Hz coordinates, log/linear axes, frame spectrum and source statistics | Long views sample analysis frames; no persistent spectral tile cache, LUFS, true peak or phase vectorscope |
| Selection | Time, rectangle, lasso and smooth weighted brush; individual/linked channel scope; numeric rectangle editing | No brush eraser, pressure, union/subtraction or intelligent event selection |
| Processing | Ordered reversible spectral gain layers, enabled/bypass, names, reorder/delete, undo/redo; original/result/removed comparison | One processor type; fixed 2048-point FFT/512-sample hop; no healing, noise reduction or other restoration algorithms |
| Playback | Native CPAL default device for native sources; bounded queues and consumed-frame progress; browser AudioWorklet for browser sources | Playback snapshots stop on edit; no seamless graph switching, device picker or measured production latency |
| Projects | Schema-1 JSON snapshots, source SHA-256 check and relink, editable gain stack | Explicit save only; no journal, autosave, crash recovery, embedded audio or migration framework |
| Export | Source-rate/channel float32/64 WAV/RF64; same Rust renderer; Windows temporary-file finalization and source-path protection | No integer/dither export or metadata preservation; physical >4 GiB files not qualified |
| Interface | Original dark workspace, layers/inspector, tool shortcuts, zoom/pan, overview, numeric alternatives, WebGL2 display with Canvas2D fallback | No WebGPU, remote collaboration, revision comparison, AI or formal usability/accessibility qualification |
| Distribution | Browser assets, Windows x64 setup, Apple Silicon/Intel DMG, Linux Debian/AppImage | Development prerelease; unsigned Windows / unnotarized Mac; installed-app checks pass, broader installer/device qualification remains |

Original recordings are opened read-only. Display settings cannot change processing parameters. Monitor conversion uses f32 and a bounded sinc converter; export retains the source sample rate and uses f64 processing. Processing is local, with no server or uploaded audio.

## Verification evidence

Checks ran locally on Windows x64 using Node 24.14.0, Rust 1.94.0, Chrome, and the packaged Tauri/WebView2 application. These are development checks on synthetic fixtures, not an independent professional-audio qualification campaign.

| Check | Result | Evidence and scope |
| --- | --- | --- |
| Rust numerical integration tests | **17 passed** | [audio_contracts.rs](../../crates/tonalia-core/tests/audio_contracts.rs): calibration, exact no-op, PCM extrema/f64 precision, float headroom, malformed/truncated/nonfinite rejection, RF64 headers, masks/channel scope, locality, serial-layer chunk equivalence, edges, source statistics and monitor conversion |
| Browser end-to-end tests | **9 passed, 27.8 s** | [editor.spec.ts](../../tests/e2e/editor.spec.ts): real exported attenuation, exact untouched channel/outside support, display-independent output, project/relink fingerprint, invalid import preservation, Worklet clock, brush/lasso persistence, graphics-loss fallback and source filename protection |
| Packaged native smoke test | **Passed** | [native-smoke.json](native-smoke.json), produced by [smoke.mjs](../../tests/native/smoke.mjs): command-line source open, native range IPC, worker analysis, native playback progress, native float64 export, project save and source lifecycle/overwrite guards |
| Browser/WASM production build | **Passed** | `npm run build`: notices generation, release WASM, TypeScript and Vite |
| Windows release packaging | **Passed** | Tauri release build produced executable and x64 NSIS installer |
| Static/format checks | **Passed** | TypeScript; Rust formatting; core Clippy with warnings denied; Prettier |
| npm audit | **0 reported vulnerabilities** | Local installed dependency tree; advisory results are time-specific and do not constitute a security assessment |

The packaged native fixture is four seconds of 48 kHz stereo 16-bit PCM, with a 937.5 Hz tone and opposite channel polarity. Its left-only −6 dB region exported at **−5.9999996705 dB**; the untouched right channel and samples outside processing support had maximum absolute error **0** in float64 output. Source bytes remained unchanged. The test also checks that an unaccepted replacement source can be released without invalidating the current recording. The JSON report records the actual WebView version, timing and transport observation.

The original native export/project checks invoked commands directly. The subsequent [installed Windows test](windows-installed-offline.json) additionally used the actual native Open WAV, Export WAV and Save Project dialogs with outbound internet blocked. Playback evidence is successful device submission and consumed-frame clock progression; physical loopback, audibility, latency and dropout performance have not been measured. Source-load timings are individual observations and are not performance guarantees.

[View the actual packaged desktop workspace](desktop-workspace.png).

## Run or inspect

- [README and operating instructions](../../README.md)
- Standalone: `target/release/tonalia-desktop.exe`
- Installer: `target/release/bundle/nsis/Tonalia_0.1.0_x64-setup.exe`
- Browser: `npm run dev`, then `http://127.0.0.1:1420`
- Optional native launch: `tonalia-desktop.exe "C:\\Audio\\recording.wav"`

Build outputs and dependencies are ignored by Git; reproduce them using the lockfiles and pinned Rust toolchain. [Artifact sizes and SHA-256 hashes](build-artifacts.json) identify the published installers. `npm run desktop:build` generates browser assets and the package for the current platform; the release workflow builds all supported targets. Licence notices are bundled at `/licenses/THIRD-PARTY.txt`, with a machine-readable dependency inventory beside them. See [dependency notes](DEPENDENCIES.md).

## Remaining engineering gates

The initial viewer/editor vertical slice covers portions of P0–P2. It does **not** satisfy their complete exit criteria: reference measurements, a frozen hardware/corpus baseline, long-file qualification, durable recovery and formative user testing are still missing. Some basic layer/inspector interactions from P4 are present; this does not move the overall product past restoration.

1. **Qualify the foundation:** pin a licensed Audition reference build; add independent FFT/reference comparisons and fixture rights; test one-hour files, physical RF64, seeks, high-rate/device combinations, loopback, underruns, UI stalls, corrupt media and long-session memory. Measure the roadmap's latency/interaction budgets on named hardware.
2. **Complete local editing durability and scale:** implement recovery journal/autosave, fault-injected save/export, persistent analysis caches, richer selection algebra/eraser/pressure, multiresolution processing research and seamless prepared-graph previews. Validate screenshot overlays against numerical masks across zoom levels. Preserve schema/engine versions before changing render semantics.
3. **Implement restoration in separate tested increments:** hum removal and click repair, then profile/adaptive noise reduction, healing/inpainting and declipping. Each requires held-out damage/preservation fixtures, residual listening and independent comparisons before a parity claim. Advanced dereverberation remains a separate research gate.
4. **Develop workflow and additional platforms:** revision comparison, saved views, reusable operations, device management, integer/dither export, accessibility/editor studies, signing and macOS/Linux qualification.
5. **Add collaboration, then optional AI:** durable semantic operations and assets, permissions/conflict/reconnect testing, followed by model/rights evaluation and reversible restoration candidates. No cloud or AI infrastructure is included in 0.1.

Source and platform installers are published in [fattyrecordingco/Tonalia](https://github.com/fattyrecordingco/Tonalia). No other Fatty Recording Co repository was modified or copied into this implementation.
