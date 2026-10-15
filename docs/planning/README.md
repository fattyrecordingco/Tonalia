# Tonalia master plan

**Fatty Recording Co · 15 October 2026 · Revision 1 research baseline · Implementation subsequently authorized**

Tonalia will be a professional, nondestructive spectral audio editor: visually isolate a fault, hear the affected sound, apply a reversible operation, compare the result, and deliver an accurate audio file. Its ambition is the depth of Adobe Audition's relevant spectral and analysis tools with the immediacy, object model, and collaboration of a modern canvas application.

This package records the original researched product and engineering proposal. It predates the subsequent implementation approval. See [implementation status](../implementation/STATUS.md) for delivered code and measured checks. All numerical targets below remain proposed release gates until independently verified; the development release does not establish parity.

## Read the package

| Document | Purpose |
| --- | --- |
| [01 — Product and scope](01-product-and-scope.md) | Users, workflows, release boundaries, principles, and product decisions |
| [02 — Audition research and parity matrix](02-audition-research-and-parity.md) | Documented reference behavior, coverage, planned equivalents, and verification cases |
| [03 — Figma research and interface specification](03-figma-and-interface.md) | Original workspace, interaction contracts, shortcuts, accessibility, and usability gates |
| [04 — Technical architecture](04-technical-architecture.md) | Stack tradeoffs, engine boundaries, threading, rendering, performance, and dependency choices |
| [05 — DSP research and processing contracts](05-dsp-research.md) | Reconstruction mathematics, masks, restoration algorithms, analysis, precision, and research experiments |
| [06 — Project model and collaboration](06-project-and-collaboration.md) | Persistence, history, concurrency, security, assets, and optional AI lifecycle |
| [07 — Roadmap and engineering backlog](07-roadmap-and-backlog.md) | Stage gates, estimates, dependencies, accountable roles, and implementation-ready work packages |
| [08 — Testing and parity verification](08-testing-and-verification.md) | Fixtures, numerical tolerances, performance methodology, listening studies, and release evidence |
| [09 — GitHub review, risks, and decisions](09-github-risks-decisions.md) | Repository inspection, reuse recommendations, risk register, and unresolved choices |
| [10 — Research sources](10-research-sources.md) | Primary sources, evidence limitations, and follow-up research |

## Recommended technical direction

Adopt a **desktop-first Rust engine**, with a **React/TypeScript control interface** and a tiled GPU spectral canvas. Evaluate **Tauri 2** first, with Electron as a measured fallback if system WebViews cannot deliver reliable graphics and accessible interaction on the supported platforms. The shell decision is conditional; the native audio engine is independent of it.

Keep original media immutable. Store edits as versioned, ordered operations and masks. Derive playback and export from the same processing graph. Use Rust/WASM to share suitable kernels with an eventual browser client. Use WebGPU where supported for visualization; provide WebGL2 and a reduced-performance CPU display fallback. Avoid GPU dependence in the authoritative audio renderer.

Begin with reliable decoding, playback, calibrated STFT analysis, bounded-memory file access, and correct inverse reconstruction. Then build actual spectral edits and persistence. Restoration, polished object workflows, network collaboration, and AI follow in that order. Minimal layers and undo belong in the first editor; advanced layer workflow belongs in the later workflow stage.

## Stages and approval boundary

| Stage | Deliverable | Principal gate |
| --- | --- | --- |
| P0 — Research | This package, followed after approval by reference measurement and feasibility experiments | Owner approves development; test baseline and architecture decisions recorded |
| P1 — Working spectral viewer | Real files, calibrated waveform/spectrogram, playback, navigation | Numerical analysis and large-file performance pass |
| P2 — Functional spectral editor | Weighted selections, spectral gain/attenuation, masks, layers, save/reopen/export | Reconstruction, edit localization, undo, and recovery pass |
| P3 — Professional restoration | Profile/adaptive noise reduction, hum, click/clip repair, healing; advanced restoration as separately gated work | Objective fixtures plus independent listening and reference comparisons pass |
| P4 — Figma-like workflow | Rich layers, inspector, reusable operations, history comparison, fast interaction | Task success, responsiveness, and accessibility gates pass |
| P5 — Collaboration | Shared edits, comments, presence, revision links, resilient reconnect | Convergence, permissions, durable assets, and failure tests pass |
| P6 — AI assistance | Optional, reversible suggestions and restoration candidates | Model/data rights, preservation, reproducibility, and quality gates pass |

With approximately five full-time-equivalent specialists, sequential planning ranges total **75–127 working weeks**, before a recommended 25% contingency: roughly **22–37 months** for the full staged vision. A useful local editor arrives much earlier; a viewer is not a professional editor release. These are capacity-based estimates, not delivery dates. The roadmap explains staffing, uncertainty, and release slices.

## What must be true before a professional release

- Original media remains recoverable and unchanged; a project reopens and reproduces every edit.
- Playback and export agree under the same engine, parameters, precision, and graph revision.
- Spectrogram brightness is calibrated, with explicit units; display preferences never alter sound.
- An edit's actual time/frequency influence is visible, including window support and feathering.
- Audio continues when the UI stalls, cache work runs, or the GPU is lost.
- Every supported processor has numerical, failure, and listening evidence appropriate to its behavior.
- Unsupported formats, sample rates, channels, hardware, and processors fail explicitly.
- Every parity statement names the tested Audition build, Tonalia build, operating system, fixture set, and known exceptions.

## Decisions to approve with this plan

The proposed starting scope is Windows 11 x64 and macOS Apple Silicon, local/offline use, mono/stereo WAV at original sample rate, Rust engine, and a conditional Tauri shell. Linux and a browser reviewer are subsequent qualification targets. No cloud account is required for local editing. Full DAW mixing, video post-production, legacy plugin hosting, and unrestricted source separation are outside the initial release.

The supplied [fattyrecordingco/Tonalia repository](https://github.com/fattyrecordingco/Tonalia) is the dedicated repository. Its public initial state already had an MIT licence. The repository review records that historical state and distinguishes it from code-reuse permissions. This planning package and the subsequently authorized implementation are now published there; see [distribution status](../implementation/DISTRIBUTION.md).

**Historical approval boundary:** the owner subsequently authorized implementation. The [development status](../implementation/STATUS.md) distinguishes delivered functionality from outstanding stage gates; approval does not establish that a capability or performance target has been achieved.
