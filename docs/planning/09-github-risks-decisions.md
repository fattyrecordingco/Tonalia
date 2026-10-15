# GitHub review, reuse, risks and decisions

**Read-only public inspection · 15 October 2026 · No code copied, repositories modified, branches created, commits made or pushes performed.**

## Dedicated Tonalia repository

Use the supplied [fattyrecordingco/Tonalia](https://github.com/fattyrecordingco/Tonalia) as the dedicated project repository. Public inspection found `main` at `901bfded4a2aceb9d4202d6cd1001330c84db9de`, with an initial README and MIT licence. Preserve that licensing decision unless the owner explicitly changes it; third-party notices and model/SDK obligations remain separate.

The local workspace is now named `Tonalia`; earlier environment context called it `Tonalis`. The actual directory was inspected before saving these documents. The planning package is added under `docs/planning/` only. The remote repository has not been connected, pulled, overwritten or pushed by this task. Do not create a second repository because the originally requested name is now already provided.

Public GitHub REST repository inventory and complete recursive trees were inspected. Relevant manifests, source files and tests were read at the snapshots below. This is a source-level reuse review, not a build, security audit, binary review or verification that repository README claims work. Private repositories and unlisted local projects were not inspected.

## Repositories reviewed

| Repository / pinned snapshot | Evidence examined | Reuse recommendation |
| --- | --- | --- |
| [BECAfirmware](https://github.com/fattyrecordingco/BECAfirmware/tree/6db2f66aa0395b812a741227fd358b5d08202019) | Root Rust workspace; C++ DSP; host audio tests; phone WASM/AudioWorklet build; Tauri setup manifest; MIT metadata | Strongest transferable engineering patterns: deterministic host tests, preallocated WASM configuration, shared native/web DSP build discipline and release/setup experience |
| [FRCo_V2M](https://github.com/fattyrecordingco/FRCo_V2M/tree/e51d04460efb63046858e39d99e47774ce3fc50d) | VINS README; React/Tauri manifests; Python audio loader/tests; benchmark description; JUCE plugin CMake | Reuse concepts for installer workflow, fixture manifests and audio task ergonomics; independently implement engine and preserve channels/rate |
| [WizAPP](https://github.com/fattyrecordingco/WizAPP/tree/f303aea35782721db56cd4f35888910319d92cd8) | Electron/React/TypeScript package manifest; upstream-facing README; GPLv3 licence; fork metadata | Reference desktop app structure and update/tray UX; low audio relevance; no source extraction into the MIT plan without an explicit compatible licensing decision |
| [Tonalia](https://github.com/fattyrecordingco/Tonalia/tree/901bfded4a2aceb9d4202d6cd1001330c84db9de) | Initial public tree/README/licence | Correct destination for new independent work; no application engine found in inspected initial state |

## File-level findings

### BECAfirmware

The [host audio test guide](https://github.com/fattyrecordingco/BECAfirmware/blob/6db2f66aa0395b812a741227fd358b5d08202019/tests/audio/README.md) describes compiling real synth/drum/DSP sources against minimal host stubs. It covers sine PCM, pitch changes, silence/disconnect and parameter sanitization, and explicitly does not emulate hardware scheduling. Adopt this honest separation of numerical tests from hardware timing.

The [phone AudioWorklet](https://github.com/fattyrecordingco/BECAfirmware/blob/6db2f66aa0395b812a741227fd358b5d08202019/apps/beca-phone/audio-worklet.js) reads an Int16 WASM buffer and converts to browser float channels. This is an instrument-specific path, not Tonalia's loss-preserving arbitrary audio processing engine. Do not inherit its 16-bit buffer, two-channel indexing or instrument parameter assumptions.

The [WASM build script](https://github.com/fattyrecordingco/BECAfirmware/blob/6db2f66aa0395b812a741227fd358b5d08202019/apps/beca-phone/scripts/build-audio.mjs) uses fixed initial memory with growth disabled and source fingerprinting. Its build reproducibility/preallocation pattern is useful; its Emscripten/C++ ABI is not required by a Rust/WASM design.

The [setup manifest](https://github.com/fattyrecordingco/BECAfirmware/blob/6db2f66aa0395b812a741227fd358b5d08202019/apps/beca-setup/src-tauri/Cargo.toml) shows existing Tauri/Rust tooling familiarity. Hardware flashing, serial/network device setup, embedded timing and synth envelopes do not provide spectral editing, iSTFT, nondestructive graph or project persistence. MIT metadata makes review for extraction plausible, but verify file authorship, bundled assets and dependency notices first.

### FRCo_V2M / VINS

The [audio loader](https://github.com/fattyrecordingco/FRCo_V2M/blob/e51d04460efb63046858e39d99e47774ce3fc50d/backend/app/services/audio_io.py) explicitly downmixes to mono, casts to float32 and resamples when requested. Those choices fit analysis/transcription but conflict with Tonalia's default preservation contract. Do not reuse this loader unchanged.

The [audio enhancement tests](https://github.com/fattyrecordingco/FRCo_V2M/blob/e51d04460efb63046858e39d99e47774ce3fc50d/tests/test_audio_enhancements.py) use seeded synthetic signals and assert pitch/level behavior. Borrow the fixture discipline, while using restoration-specific ground truth and precision assertions. The [benchmark guide](https://github.com/fattyrecordingco/FRCo_V2M/blob/e51d04460efb63046858e39d99e47774ce3fc50d/benchmarks/README.md) describes local deterministic fixture/report generation; no benchmark results were reproduced here.

The [frontend manifest](https://github.com/fattyrecordingco/FRCo_V2M/blob/e51d04460efb63046858e39d99e47774ce3fc50d/frontend/package.json) and [Tauri manifest](https://github.com/fattyrecordingco/FRCo_V2M/blob/e51d04460efb63046858e39d99e47774ce3fc50d/frontend/src-tauri/Cargo.toml) are useful platform precedents. The [plugin CMake configuration](https://github.com/fattyrecordingco/FRCo_V2M/blob/e51d04460efb63046858e39d99e47774ce3fc50d/plugin/CMakeLists.txt) references JUCE 8 and VST3/AU, but it is not a ready-made Tonalia plugin host. No root licence was observed in the inspected tree/API metadata; establish reuse rights before copying source, and independently check JUCE/SDK terms.

### WizAPP

The [package manifest](https://github.com/fattyrecordingco/WizAPP/blob/f303aea35782721db56cd4f35888910319d92cd8/package.json) provides Electron/React/TypeScript and packaging precedents. Its [README](https://github.com/fattyrecordingco/WizAPP/blob/f303aea35782721db56cd4f35888910319d92cd8/README.md) points to an upstream WiZ-light controller. Fork ownership does not imply that upstream code can be relicensed. Given low audio relevance and the observed [GPLv3 licence](https://github.com/fattyrecordingco/WizAPP/blob/f303aea35782721db56cd4f35888910319d92cd8/LICENSE), prefer independent implementation for the MIT Tonalia project unless a deliberate licence-compatible plan is approved.

## Proposed reuse procedure after approval

For each candidate, record exact source commit/file, purpose, provenance/licence, dependencies, known assumptions and new Tonalia acceptance tests. Prefer a small reviewed extraction or independent implementation; do not copy repository histories, installers, unrelated artwork or whole frameworks. Never modify the source repositories without permission. No inspected repository supplies a verified complete spectral engine, spectral masks, restoration suite or collaborative project model.

## Risk register

Likelihood/impact are planning judgments. Owners correspond to the roadmap roles.

| Risk | Likelihood / impact | Trigger and mitigation | Owner / decision gate |
| --- | --- | --- | --- |
| Reconstruction/boundary artifacts | High / critical | No-op/chunk tests fail; fix frame/window/normalization before editor work | DSP / P0–P2 |
| Repair damages wanted sound | High / critical | Held-out preservation/listening failure; narrow scope and require candidate review | DSP+QA / P3 |
| Spectral latency exceeds monitor needs | High / high | Lookahead/CPU miss budget; distinguish live and pre-rendered modes with measured latency | SYS+DSP / P1–P3 |
| Large files exhaust RAM/VRAM/disk | High / high | Caches grow beyond budget; chunk/LRU/backpressure/RF64 qualification | SYS+UI / P1 |
| WebView/GPU portability | Medium / high | Canvas/fallback/accessibility gates fail; choose Electron or narrow supported platforms | UI / P0 |
| Source or acknowledged edit loss | Medium / critical | Crash/disk-full/relink failure; immutable assets, journals and fault injection | SYS+QA / P2 |
| Consumer sync corrupts active project | Medium / high | Concurrent syncing database/files; use managed working directory and atomic snapshots | SYS / P2 |
| Same-looking collaboration, different sound | High / critical | Conflicting graph order/state or model mismatch; semantic preconditions, revision hashes, frozen assets | COL+DSP / P5 |
| Cloud media disclosure or access failure | Medium / critical | Unauthorized request/upload/revocation bug; scoped ACLs, explicit sharing, security tests | COL / P5 |
| Dependency/SDK/model rights conflict | Medium / high | Unknown provenance or incompatible redistribution; block extraction and choose alternative | PROD+SYS / P0 onward |
| AI changes content/identity | High / high | Hallucination or domain failure; optional candidate layer and preservation studies | ML+QA / P6 |
| Unsupported parity/schedule claims | High / high | UI completion treated as DSP proof; evidence-based matrix and re-estimation | PROD / all releases |
| Name/market fit unresolved | Medium / medium | Brand conflict or poor editor adoption; clearance and recurring editor studies | PROD / before public launch |

## Decisions and unresolved work

| Decision | Proposed default | Evidence/choice still required |
| --- | --- | --- |
| Product/repository | Tonalia by Fatty Recording Co; existing dedicated MIT repository | Owner approval of master plan and eventual licensing strategy |
| Platform | Windows 11 x64 + macOS Apple Silicon first | Exact supported releases, hardware availability; Linux Intel/macOS later qualification |
| Shell | Tauri first candidate; Electron fallback | P0 compatibility, accessibility and throughput measurements |
| Audio core | Native Rust; portable pure kernels | f32/f64 policy and CPAL/platform coverage measurements |
| Graphics | Tiled GPU canvas with CPU-derived spectra initially | WebGPU/WebGL2 performance on selected shell |
| File model | Local immutable media, journal and portable snapshots | Container choice, recovery behavior and large-file tests |
| First release scope | Spectral local editor; core restoration follows | Whether advanced P3b features are required before public release |
| Collaboration | Server-ordered semantic graph edits; optional CRDT metadata | Offline/conflict UX tests and hosting/region/retention choices |
| AI | Optional reversible candidates, local-first preference | Model choice, compute budget, data/weight rights and preservation evidence |
| Commercial operations | No account for local editing | Pricing, support, funding, signing certificates, cloud budget and business model |

These unresolved items do not prevent delivering the planning package. They become explicit engineering or product decisions after approval. No application implementation begins as part of this task.
