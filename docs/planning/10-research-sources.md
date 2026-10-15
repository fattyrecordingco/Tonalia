# Research source register

**Consulted 15 October 2026.** Links point to primary vendor documentation, standards bodies, original research or source repositories. Descriptions identify what each source supports; Tonalia requirements, targets, schedule estimates and architecture choices are original proposals. Documentation describes intended behavior, not verified behavior in every version. No proprietary code, artwork or source assets were copied.

## Research method and limitations

Adobe documentation was reviewed for display, selection, restoration, diagnostics, analysis, supporting effects, device setup and delivery behavior. Figma documentation and engineering writing were reviewed for interaction, object structure, history and collaboration. Standards, numerical-library documentation and published audio research informed candidate implementation and verification methods. Public GitHub REST metadata, complete recursive trees and selected files informed repository reuse recommendations.

No Adobe Audition or Figma application session was exercised. No audio output was compared, dependency built, hardware measured or reusable source tested. Some Adobe regional URLs redirected to the current desktop documentation; some repeated fetches timed out, while the corresponding primary pages were accessible through other requests. Page dates can be older than current software; a freshly crawled page is not a new release specification.

The feature inventory is a substantial documented relevant baseline, not a certified exhaustive inventory of every Audition edition, hidden preference or DAW feature. P0 must reconcile every relevant control in a pinned installed reference build and extend the matrix before broad parity claims. Exact proprietary algorithms are not inferred from user-facing descriptions.

## Adobe Audition

### A01

[Displaying audio in the Waveform Editor](https://helpx.adobe.com/audition/desktop/editing-audio-files/displaying-audio-waveform-editor.html). Supports waveform/spectral arrangement, axes, channel display modes, spectral window/resolution/range controls, amplitude units and frequency scales. Display settings are distinguished from audio amplitude.

### A02

[Selecting audio](https://helpx.adobe.com/ie/audition/desktop/editing-audio-files/selecting-audio.html). Supports time/spectral selections, marquee/lasso/paintbrush, opacity and accumulation, channel targeting, selection audition, Spot Healing/Auto Heal behavior and limit, zero crossings and snapping. Exact processor/mask interactions remain empirical follow-up.

### A03

[Noise reduction and restoration effects](https://helpx.adobe.com/audition/desktop/effects-reference/noise-reduction-restoration-effects.html). Supports profile/adaptive reduction, hiss, hum, click/pop tools, sound models, DeNoise/DeReverb, residual audition and the live/offline distinction. Source description is not evidence that any independently implemented algorithm has equivalent quality.

### A04

[Diagnostics effects](https://helpx.adobe.com/ie/audition/desktop/effects-reference/diagnostics-effects-waveform-editor-only.html). Supports scan/review/repair lists, DeClicker, clipping reconstruction controls, silence detection/marking and duration-preserving versus shortening behavior. Beta Mic Check is outside Tonalia's initial spectral-restoration scope.

### A05

[Filter and equalizer effects](https://helpx.adobe.com/audition/desktop/effects-reference/filter-equalizer-effects.html). Supports FFT/graphic/parametric/notch/scientific filter families and their response/resolution controls. A control's name is not an algorithm specification.

### A06

[Time and pitch manipulation effects](https://helpx.adobe.com/audition/desktop/effects-reference/time-pitch-manipulation-effects.html). Supports correction/display, pitch bender/shifter and offline stretch/pitch. The documented licensed algorithms are not available for copying; Tonalia's transformations require their own phase/transient tests.

### A07

[Converting sample types](https://helpx.adobe.com/audition/desktop/editing-audio-files/converting-sample-types.html). Reference for rate/channel/bit-depth conversion behavior and precision-related workflow. Tonalia's conversion tolerances and source-preservation policy are independently specified.

### A08

[Applying effects in the Waveform Editor](https://helpx.adobe.com/audition/desktop/applying-effects/applying-effects-waveform-editor.html). Supports rack order, bypass/presets, the 16-slot reference and separate intensive process effects. Tonalia's live versus rendered preview contracts do not depend on matching this UI.

### A09

[Viewing, zooming and navigating audio](https://helpx.adobe.com/ie/audition/desktop/workspace-and-setup/viewing-zooming-navigating-audio.html). Supports editor-method distinctions, zoom/navigation, selection/ruler interactions and overview behavior.

### A10

[Undo, redo and history](https://helpx.adobe.com/ie/audition/desktop/editing-audio-files/undo-redo-history.html). Reference for local editing history. Tonalia's durable revisions and collaborative undo are separate requirements.

### A11

[Connecting to audio hardware](https://helpx.adobe.com/ie/audition/desktop/workspace-and-setup/connecting-audio-hardware.html). Supports native hardware drivers, buffer/rate/clock setup and channel mapping. Driver availability does not establish a particular measured latency.

### A12

[Amplitude and compression effects](https://helpx.adobe.com/ie/audition/desktop/effects-reference/amplitude-compression-effects.html). Reference for gain, normalization, dynamics and speech-oriented processing families. Full control-by-control dynamics coverage is deferred to its own qualified scope.

### A13

[Match loudness](https://helpx.adobe.com/ie/audition/desktop/editing-audio-files/match-loudness.html). Supports target/tolerance/true-peak workflows and listed standards. Use current ITU/EBU publications for Tonalia's standards implementation; Adobe help includes historical standards references.

### A14

[Save and export audio files](https://helpx.adobe.com/ie/audition/desktop/saving-and-exporting/saving-exporting-files1.html). Reference for export/file/selection workflows and format settings. Verify redirects if Adobe reorganizes help.

### A15

[Supported import formats](https://helpx.adobe.com/ie/audition/desktop/importing-recording-and-playing/supported-file-formats.html). Supports broad reference format coverage. Tonalia publishes only tested codec/container/profile combinations.

### A16

[Adding third-party plug-ins](https://helpx.adobe.com/ie/audition/desktop/applying-effects/adding-third-party-plug-ins.html). Supports VST/VST3, macOS AU and scan/enable behavior. Hosting, SDK terms and processor state are an independent later engineering program.

### A17

[Analyze phase, frequency and amplitude](https://helpx.adobe.com/audition/desktop/editing-audio-files/analyzing-phase-frequency-amplitude.html). Supports pairwise phase meter, spectrum scan/holds/graphs, amplitude statistics and RMS histogram. Tonalia uses explicit units and algorithms rather than inheriting ambiguous legacy labels.

## Figma

| ID | Primary source | Use and caveat |
| --- | --- | --- |
| F01 | [Explore design files](https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files) | Canvas/layers/pages and interface organization; Tonalia needs bounded audio coordinates |
| F02 | [Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects) | Direct selection, nested objects, multiple selection and layer panel behavior |
| F03 | [Right sidebar properties](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar) | Selection-driven properties and review; does not prescribe Tonalia's layout |
| F04 | [Zoom and view options](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options) | Fit/selection shortcuts, gestures and local view behavior |
| F05 | [Version history](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history) | Historical preview/restore and retained history; permissions/plan behavior may change |
| F06 | [Spotlight and follow](https://help.figma.com/hc/en-us/articles/360040322673-Present-to-collaborators-using-spotlight) | Shared viewport/review; not sample-synchronous audio collaboration |
| F07 | [How Figma's multiplayer technology works](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) | Original 2019 engineering explanation of property updates, ordering and reconnect; historical rather than current-service certification |

## Architecture and libraries

| ID | Primary source | What it supports |
| --- | --- | --- |
| T01 | [Tauri architecture](https://tauri.app/concept/architecture/) | Rust/webview toolkit and message-passing boundary |
| T02 | [Tauri process model](https://tauri.app/concept/process-model/) | Core/WebView process responsibilities |
| T03 | [Tauri WebView versions](https://tauri.app/reference/webview-versions/) | Platform runtime dependence; capability testing is necessary |
| T04 | [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model) | Main/renderer/utility process model and bridge structure |
| T05 | [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) | Isolation, sandbox and IPC security considerations if selected |
| T06 | [WebGPU specification](https://www.w3.org/TR/webgpu/) | GPU pipelines/resources/limits; not universal deployment availability |
| T07 | [Web Audio 1.0](https://www.w3.org/TR/webaudio-1.0/) | Audio graph/AudioWorklet and 128-frame render-quantum baseline |
| T08 | [Web Audio 1.1](https://www.w3.org/TR/webaudio-1.1/) | Evolving configurable render-size semantics; browser support must be tested |
| T09 | [Rust wasm32-unknown-unknown target](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html) | Standard-library/platform limits of portable WASM target |
| T10 | [Cross-origin isolation](https://web.dev/articles/coop-coep) | Browser SharedArrayBuffer/WASM-thread deployment requirements, from browser-platform engineering guidance |
| T11 | [CPAL](https://github.com/RustAudio/cpal) | Native backend/device/stream abstractions; optional backend/features need qualification |
| T12 | [RustFFT](https://docs.rs/rustfft/latest/rustfft/) | FFT planning, SIMD paths and supported transform API; normalization independently tested |
| T13 | [Symphonia](https://github.com/pdeljanov/Symphonia) | Demux/decode scope and MPL-2.0 project licence; not a general encoder |
| T14 | [rubato](https://docs.rs/rubato/latest/rubato/) | Sinc/FFT/asynchronous resampling options and method tradeoffs |
| T15 | [Yjs introduction](https://docs.yjs.dev/) | Shared data types and network-independent convergence model |
| T16 | [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager) | Selective/scoped undo building blocks; no automatic valid DSP graph guarantee |

Dependencies are a shortlist. No exact release is selected or installed by this plan. Re-read source/licence/security state and pin the chosen version at implementation kickoff.

## DSP, standards and original research

| ID | Primary source | Use in the plan |
| --- | --- | --- |
| D01 | [SciPy ShortTimeFFT](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.ShortTimeFFT.html) | Independent STFT/dual-window and inverse reference; edge convention awareness |
| D02 | [Boll, 1979: spectral subtraction](https://ieeexplore.ieee.org/abstract/document/1163209/) | Classical profile-noise baseline; DOI `10.1109/TASSP.1979.1163209`; abstract/metadata consulted, not a complete implementation specification |
| D03 | [Mokrý et al., 2018: SPAIN](https://arxiv.org/abs/1810.13137) | Candidate sparse audio inpainting research; independent experiments required |
| D04 | [Mokrý and Rajmic, 2020: inpainting revisited](https://arxiv.org/abs/2001.02480) | Inpainting amplitude/preservation challenges and weighting approaches |
| D05 | [NARA-WPE](https://github.com/fgnt/nara_wpe) | Original reference implementation and cited WPE literature for speech dereverberation |
| D06 | [Valin, 2017: hybrid DSP/deep learning enhancement](https://arxiv.org/abs/1709.08243) | RNNoise research baseline; speech focus, not general audio restoration parity |
| D07 | [RNNoise source](https://github.com/xiph/rnnoise) | Candidate inference/reference implementation; weights/data terms must be checked separately |
| D08 | [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en) | Loudness/true-peak algorithm reference, revision 5; official document must guide detailed implementation |
| D09 | [EBU loudness publications/test set](https://tech.ebu.ch/loudness/) | R128, Tech 3341/3342 and official qualification vectors; no conformance claimed |
| D10 | [EBU R128 publication](https://tech.ebu.ch/publications/r128) | Current referenced recommendation and its revision history |
| D11 | [ITU-R BS.1116-3](https://www.itu.int/rec/R-REC-BS.1116-3-201502-I/en) | Small-impairment listening assessment methodology |
| D12 | [ITU-R BS.1534](https://www.itu.int/rec/R-REC-BS.1534/en) | Multiple-stimulus listening assessment family; exact applicable revision/procedure to be selected before study |

Abstract-only research supports candidate selection, not an invented claim to have reproduced the paper. The first engineering research phase must study the complete chosen method, evaluate rights/dependencies and reproduce a baseline on the declared corpus before adopting it.

## Repository evidence

| Repository | Snapshot inspected | Representative evidence |
| --- | --- | --- |
| [Tonalia](https://github.com/fattyrecordingco/Tonalia) | `901bfded4a2aceb9d4202d6cd1001330c84db9de` | Initial README/licence/tree; user-supplied destination |
| [BECAfirmware](https://github.com/fattyrecordingco/BECAfirmware) | `6db2f66aa0395b812a741227fd358b5d08202019` | Root Cargo workspace, C++ DSP, audio tests, phone WASM/worklet build and Tauri manifest |
| [FRCo_V2M](https://github.com/fattyrecordingco/FRCo_V2M) | `e51d04460efb63046858e39d99e47774ce3fc50d` | React/Tauri/Python manifests, audio loader/tests, JUCE CMake and benchmark guide |
| [WizAPP](https://github.com/fattyrecordingco/WizAPP) | `f303aea35782721db56cd4f35888910319d92cd8` | Package/README/GPL licence and fork metadata |

The [repository review](09-github-risks-decisions.md) contains immutable file links and the specific implications. Public inventory was fetched with the GitHub REST user-repositories endpoint (`per_page=100`); the response had no next-page link. Three existing public projects were returned before the later supplied Tonalia repository was inspected separately. This is not a claim about private holdings.

## Follow-up research required before broad parity claims

1. Inspect installed reference applications and pin exact versions/platforms; document every relevant menu/dialog/control not covered by public help.
2. Capture original test recordings and verify redistribution rights for fixtures/standards vectors.
3. Read and reproduce selected full DSP methods; compare numerical conventions and boundary behavior.
4. Measure target audio hardware, actual WebViews and fallback rendering, including high-DPI/accessibility.
5. Evaluate precision, sample-rate conversion, source formats, RF64, channel layouts and long-session resource behavior.
6. Qualify advanced healing, dereverberation and sound-model removal independently; publish failed and partial domains.
7. Verify every proposed dependency, SDK and model's pinned licence/security/maintenance state before integration.
8. Conduct editor workflow and blind quality studies, then update estimates and scope from evidence.

**Research complete enough to propose a staged engineering program; capability, performance and parity validation remain future work.**
