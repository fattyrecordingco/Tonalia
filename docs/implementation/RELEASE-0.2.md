# Tonalia 0.2: navigation, restoration, recovery and LAN sessions

This development release extends the working editor. It does **not** complete the professional product roadmap or establish Adobe Audition parity. The research and acceptance gates in `docs/planning/` still apply.

## Navigation and editing workflow

Wheel scrolling zooms time around the pointer. Trackpad Ctrl-wheel pinch and Safari gesture events use the same bounded navigation calculation. Horizontal scrolling and Shift-scroll pan time; Alt-scroll zooms frequency, preserving the frequency under the pointer on linear and logarithmic axes. Zoom cannot move outside the source or below a 64-frame viewport. Navigation never changes edit geometry or processing FFT size.

Press `?` or choose **Shortcuts** for the complete list. `+`/`-` zoom, `0`/Shift+1 fit the source, Shift+2 fits the selection, arrows pan, Home/End seek, Space plays/stops. Ctrl/Cmd+O opens a WAV, +S saves a project, +E exports, +A selects all, +Enter creates/updates a gain layer, +Z undoes, +Shift+Z or Ctrl+Y redoes. Delete removes the selected layer. Tool keys T/M/L/B/H and brush brackets remain available. Text fields, composition input and modal dialogs retain their own keyboard behavior. Repeated keydown cannot toggle transport or repeatedly apply an edit.

The **History** dialog offers the most recent 20 local checkpoints across sources. IndexedDB stores manifests after 1.5 seconds of inactivity, without copying recordings. A checkpoint includes the source SHA-256, layers and view; restoring uses the same source identity validation as a saved project. History is local to the app/browser profile. It is not a substitute for saved projects: deletion of app data, quota exhaustion or a crash before the debounce expires can lose the latest edits. Storage failure produces a visible save-project notice.

## Versioned processors

Projects saved by 0.2 use schema 2 and `spectral-edit-v2`; legacy schema 1 / `spectral-gain-v1` projects remain readable. Older apps do not understand the new project engine and should reject it. Existing gain mathematics is unchanged. Each restoration operation is a reversible ordered layer; enable/bypass, reorder, delete, undo/redo, project save, Result/Original/Removed and export operate on the same graph. Restoration parameters are immutable in this first interface: delete and recreate a layer to revise its settings. Gain controls cannot silently convert a restoration layer.

| Processor | Implementation | Supported scope and limits |
| --- | --- | --- |
| Spectral gate | Calibrated Hann STFT bin amplitudes; smooth 12 dB threshold knee; configurable 0–60 dB reduction; phase-preserving gain deltas | Rectangle, lasso or brush masks, channel scope and feathers. This is **not** captured noise-profile subtraction or adaptive noise reduction. |
| Harmonic hum attenuation | Triangular attenuation around integer multiples of a 20–200 Hz fundamental | Width is one 2048-point FFT bin. At 48 kHz that is 23.4375 Hz; this cannot substitute for precision narrow IIR hum filtering. Same spectral masks and scopes as gain. |
| Short-click interpolation | Linear reconstruction between the intact samples immediately before/after the selected interval | Full-band, integer-frame rectangle, at most 10 ms; endpoints must exist; no feather. Intended for isolated short discontinuities, not general spectral inpainting. Other samples and channels are exact bypass. |
| Offline neural speech denoise | Included nnnoiseless 0.5.2 default RNNoise model, f32 inference, dry/wet strength | 48 kHz only; mono/stereo, one neural layer, channels processed independently. Full-band time rectangle. Not trained or qualified here for music, dialogue enhancement generally, or perceptual parity with commercial tools. Model input is clamped to normalized ±1; unselected original float headroom is preserved. |

All processors are independently integrated into Tonalia's own layer/selection/render implementation. No Adobe code or artwork is used. The RNNoise port and included model are distributed under their upstream BSD terms, included in the bundled third-party notices. Upstream: [nnnoiseless source/package](https://github.com/jneem/nnnoiseless), [published 0.5.2 source](https://docs.rs/crate/nnnoiseless/0.5.2/source/), [Xiph RNNoise](https://github.com/xiph/rnnoise).

### Deterministic neural context

Neural output has a deliberately versioned finite-context definition, `neuralSpeechV1`. Blocks start at integer multiples of 48,000 source frames, last 96,000 frames, and have 24,000 frames of warm-up. The classic model's 480-frame delay is compensated by processing lookahead; adjacent blocks blend with periodic Hann weights whose sum is one. Source boundaries are zero extended. This is not claimed to reproduce an indefinitely stateful streaming RNNoise invocation.

The engine adds 120,480 frames of context per active neural layer, plus existing spectral context, before cropping. Therefore export chunk size, playback request size and viewport position do not relocate model resets or create different edits. The worker and native streaming engine each cache up to 16 rendered 32,768-frame tiles, invalidated by source epoch and graph. Model weights, code, fonts and UI are bundled; no model download, API key or internet is required. Processing is off the real-time callback. Neural processing can still increase preparation time or cause underruns on slow devices; latency is not professionally qualified.

## Optional LAN co-editing

Installed apps can host and join from **Share** after verifying the local source. The host starts a listener only on explicit **Host session**. Default binding is loopback; enabling **Allow private LAN connections** binds all local interfaces. Set the host's numeric private IP in its invite for other machines, which must be on the same trusted network and possess the identical WAV. Port forwarding and public IP endpoints are unsupported.

The invite contains a cryptographically random 256-bit token. The protocol exchanges bounded JSON manifests, not audio or local file paths. SHA-256, frame count, sample rate and channel count must match. Every edit includes a base revision. The host serializes accepted edits and rejects stale proposals, returning the current graph. Clients never silently merge conflicting full graphs: the accepted host graph is loaded and a rejected local proposal remains available as a downloadable project for manual reconciliation. In 0.2, rename the downloaded `.tonalia` proposal to `.tonalia.json` before using Open project, whose picker filters JSON files. Lost acknowledgments are treated as unconfirmed proposals. Polling runs every 750 ms without overlapping polls.

Shared-session undo/redo is disabled; remote revisions clear the local undo stack. Playback stops when accepted remote edits arrive. Leaving retains the current graph locally; the host listener stops when its session leaves or the app exits. This is an experimental authoritative session, not a CRDT, hosted workspace, identity/permission system, presence/cursors, durable server history, encrypted transport or offline multiwriter merge. HTTP is unencrypted: use a trusted LAN. The native client accepts numeric loopback/private addresses only, rejects redirects, and uses no proxy/DNS. The server rejects browser Origin requests and bounds manifests to 4 MiB. Internet access remains unnecessary.

## Verification and remaining qualification

`restoration_contracts.rs` tests gate calibration, hum attenuation, exact unselected channels and bypass, interpolation endpoints/locality, invalid parameters, and neural whole/crop consistency across a block boundary with differing input origins. Native protocol tests exercise a real loopback HTTP host/client, bad source/token rejection, stale revisions, stop behavior and public endpoint rejection. Browser tests cover shortcuts, wheel/pinch, audio invariance under zoom, actual restoration export, recovery across reload and neural rendering with browser networking offline.

Installed-package diagnostics on every platform now execute the bundled neural model and calibrated gate, in addition to analysis and spectral gain. The Windows native smoke script also checks CPAL, native file dialogs, source protection, native gate/neural export and an acknowledged remote edit reflected in the UI. Test reports describe the actual environment; physical cross-machine LAN, trackpad hardware, clean offline WebView installation, low-latency loopback, Gatekeeper/notarization and broad perceptual quality require further qualification.

Still outstanding: captured noise profiles, adaptive reduction, advanced spot healing/spectral inpainting, declipping, codec support beyond WAV/RF64, multichannel >2, professional loudness/true-peak/phase analysis suite, native device selection/ASIO, plugin hosting, multitrack/timeline editing, shared presence/permissions/CRDT/offline merge, hosted collaboration, and additional trained restoration models. The application must not be marketed as feature-complete or Audition-equivalent.

## Release acceptance record

The tagged source is commit `963f92fd6d1ada2d0a690addd483907e34d2600d`. [Native packaging/install workflow](https://github.com/fattyrecordingco/Tonalia/actions/runs/38756525727) and [application checks](https://github.com/fattyrecordingco/Tonalia/actions/runs/38756519220) passed. The source tag remains immutable after publication.

- 22 numerical contracts cover the original engine and initial restoration operations.
- 3 native tests cover private endpoint restrictions, real session revisions/token/source/conflict/stop behavior and cached render/source-change detection.
- 12 browser integration tests cover real exports, selection persistence, legacy workflow, keyboard/mouse/pinch navigation, recovery and offline neural rendering.
- All four native package jobs installed their output and ran the bundled React/worker/WASM analyzer, gain, gate and neural checks. Both Linux formats were launched. Mac and Linux checks denied outbound internet; per-platform reports are in this directory and attached to the release.
- `tests/native/collaboration.mjs` exercises two independent Windows native processes and WebView profiles: host edit reaches guest, guest bypass reaches host, shared undo is disabled, host shutdown is observed, and current layers survive disconnect. It uses a generated local WAV and blocks outbound WebView internet. This is loopback qualification, not physical cross-machine LAN qualification.

Published binary sizes, hashes, source commit and direct URLs are recorded in `build-artifacts.json`. The public download/owner-machine installation reports are recorded separately from the hosted-runner checks. They do not constitute an overall professional quality or feature-parity certification.
