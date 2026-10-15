# Audition behavior research and feature-parity matrix

**Evidence: Adobe documentation · Observation date: 15 October 2026 · Tonalia implementation: none**

## Evidence and parity rules

The reference column paraphrases published behavior; it is not a claim that Audition was exercised in this session. Source links resolve through the [research register](10-research-sources.md). Exact defaults, UI-version differences, undocumented edge behavior, and DSP output require an installed, licensed reference build in P0. No proprietary implementation is available or assumed.

**Every row is currently `planned / unverified`.** Stage is the earliest intended qualification, not proof of completion. `Later` denotes explicitly deferred reference coverage. Verification-family IDs resolve in [08](08-testing-and-verification.md). A feature passes only after its behavior, audio quality, persistence, and supported-platform cases pass; visual resemblance is insufficient. Tonalia need not reproduce proprietary numerical output or parameter scales to provide a verified equivalent capability.

## Display, navigation, and selection

Reference evidence for A01–A08: [Adobe display](https://helpx.adobe.com/audition/desktop/editing-audio-files/displaying-audio-waveform-editor.html). A09–A10: [Adobe navigation](https://helpx.adobe.com/ie/audition/desktop/workspace-and-setup/viewing-zooming-navigating-audio.html).

| ID | Feature | Documented Audition behavior | Proposed Tonalia contract | Stage / verification |
| --- | --- | --- | --- | --- |
| A01 | Waveform + spectrum | Resizable split display | Linked rulers, adjustable split, shared playhead | P1 / V1 |
| A02 | Spectrogram | Time horizontally; frequency vertically; intensity conveys amplitude | Calibrated legend; cursor reports physical coordinates | P1 / D1,V1 |
| A03 | FFT/window controls | Adjustable resolution and window | Explain time/frequency tradeoff; record analysis configuration | P1 / D1 |
| A04 | Brightness range | Decibel range changes display only | Floor, ceiling, contrast and palette never modify PCM | P1 / V1,D1 |
| A05 | Frequency ruler | Linear/logarithmic and intermediate scaling | Linear/log modes first; mixed scale later if useful | P1 / V1 |
| A06 | Channel views | Layered or uniquely colored waveforms | Separate lanes plus optional overlay; explicit channel labels | P1 / I1,V1 |
| A07 | Waveform ruler | dB, percent, sample and normalized values | Unit switching without modifying data | P1 / D1,V1 |
| A08 | Spectral audition preference | Selected frequencies can be heard alone | Dedicated monitor mode, visible status, transport independent of edit | P2 / E1 |
| A09 | Precise navigation | Time/frequency zoom and overview navigation | Cursor-anchored zoom; numeric bounds; view history | P1 / V1,P1 |
| A10 | Editor context | Waveform editing changes audio; Multitrack is nondestructive | One source-preserving model for spectral operations | P2 / S1 |

Reference evidence for A11–A22: [Adobe selection](https://helpx.adobe.com/ie/audition/desktop/editing-audio-files/selecting-audio.html).

| ID | Feature | Documented Audition behavior | Proposed Tonalia contract | Stage / verification |
| --- | --- | --- | --- | --- |
| A11 | Time range | Drag and extend boundaries | Integer sample endpoints with time formatting | P1 / E1 |
| A12 | Marquee | Rectangular spectral range | Numeric time/Hz bounds and channel scope | P2 / E1 |
| A13 | Lasso | Freeform spectral selection | Closed path; deterministic rasterization and feathering | P2 / E1 |
| A14 | Brush selection | Opacity and repeated strokes weight processing | Float mask; specified accumulation and erase behavior | P2 / E1,D2 |
| A15 | Selection adjustment | Move/resize; add/subtract gestures | Transform region independently of audio; modifier hints | P2 / E1 |
| A16 | Channel targeting | All channels by default; channel enabling restricts edits | Linked stereo default, persistent explicit channel list | P2 / E1,I1 |
| A17 | Selected playback | Spectral-only audition or full sound within time range | Original/result/selection/residual monitor choices | P2 / E1,D2 |
| A18 | Spot healing | Brush invokes Auto Heal on small artifacts | Reversible repair candidate with preview and cancellation | P3 / R1 |
| A19 | Healing limit | Auto Heal limited to four seconds | Publish separately tested limits; initially narrow click/gap support | P3 / R1 |
| A20 | Healing gesture | Brackets size brush; simple click can position playhead | Explicit draw-versus-transport modes; no accidental repair | P3 / E1,R1 |
| A21 | Zero crossings | Selection edges can move to zero crossings | Optional for time cuts; not an implied spectral boundary guarantee | P2 / E1,D2 |
| A22 | Snapping | Markers, ruler subdivisions, frames, zero crossings | Individually enabled targets; disable temporarily by modifier | P2 / E1 |

## Restoration inventory

Reference evidence A23–A33: [Adobe restoration](https://helpx.adobe.com/audition/desktop/effects-reference/noise-reduction-restoration-effects.html). These compact entries describe the published capabilities; Tonalia processor parameters and validation are independent proposals in [05](05-dsp-research.md).

| ID | Feature | Documented Audition behavior | Proposed Tonalia contract | Stage / verification |
| --- | --- | --- | --- | --- |
| A23 | Noise print | Capture noise-only material; save/load sample-type-specific profiles | Profile stores source range, rate, channels, algorithm and estimator | P3 / R2,S1 |
| A24 | Profile reduction | Offline suppression with frequency-dependent control and noise-only audition | Reduction ceiling, threshold curve, smoothness, preservation and residual | P3 / R2 |
| A25 | Advanced reduction | FFT, smoothing, decay, precision, transition and snapshot controls | Expose meaningful physical controls; no false equivalence of parameter values | P3 / R2,D1 |
| A26 | Adaptive reduction | Real-time response to changing noise | Adaptive estimator with reset, learning/freeze and stateful preview | P3 / R2,P2 |
| A27 | Hiss reduction | Offline suppression below a captured/editable floor | Separate floor profile and attenuation curve; residual monitoring | P3 / R2 |
| A28 | Automatic click remover | Real-time click correction; threshold/complexity | Detection and repair isolated; protect transients; report latency | P3 / R1,P2 |
| A29 | Click/Pop Eliminator | Detailed detection, rejection, repair and repeated passes | Advanced event detector with inspectable candidates and bounded passes | P3b / R1 |
| A30 | DeHummer | Root/harmonic notches, Q, gain, slope, hum-only output | Frequency/drift inspection, harmonic bounds and phase-response disclosure | P3 / R3 |
| A31 | DeNoise | Adjustable amount, spectral focus, gain and noise-only output | Simple front panel backed by tested processor controls | P3 / R2 |
| A32 | DeReverb | Estimated reverberation reduction, focus and output gain | Research-gated speech dereverberation, separate rendered candidate | P3b / R5 |
| A33 | Sound Remover | Learned sound model; complexity/refinement, enhanced suppression, speech option | Independent recurring-event model and removal; no source-separation guarantee | P3b / R5 |

Advanced Click/Pop reference controls include a level-dependent detection curve, sensitivity, discrimination, rejection, repair FFT, single-click fill, width/run grouping, channel linking, large-pop detection, crackle handling, and passes. Tonalia must qualify these control purposes if claiming this row's broad capability; copying the dialog is unnecessary. [Adobe restoration](https://helpx.adobe.com/audition/desktop/effects-reference/noise-reduction-restoration-effects.html)

Reference evidence A34–A38: [Adobe diagnostics](https://helpx.adobe.com/ie/audition/desktop/effects-reference/diagnostics-effects-waveform-editor-only.html).

| ID | Feature | Documented Audition behavior | Proposed Tonalia contract | Stage / verification |
| --- | --- | --- | --- | --- |
| A34 | Diagnostic list | Scan, inspect and selectively repair/delete/mark events | Event list linked to canvas, confidence and per-event acceptance | P3 / R1,V1 |
| A35 | DeClicker | Threshold/complexity; selective repair of detected clicks | Calibrated detector controls; explicit exclusions and review queue | P3 / R1 |
| A36 | DeClipper | Gain, tolerance, minimum run; cubic or FFT reconstruction | Constrained reconstruction preserving reliable samples; headroom disclosure | P3 / R4 |
| A37 | Silence tools | Level/duration detection; shorten, mute or mark | Distinguish ripple removal from duration-preserving mute; preview result | P3 / E1,R6 |
| A38 | Diagnostic navigation | Zoom to candidates; clear addressed entries | Stable event IDs and resolution history; no stale revision results | P3 / V1,S1 |

## Frequency, phase, and amplitude analysis

Reference evidence A39–A50: [Adobe analysis](https://helpx.adobe.com/audition/desktop/editing-audio-files/analyzing-phase-frequency-amplitude.html).

| ID | Feature | Documented Audition behavior | Proposed Tonalia contract | Stage / verification |
| --- | --- | --- | --- | --- |
| A39 | Phase meter | Pairwise channel comparison from −1 to +1 | Correlation with defined window; silence/low confidence marked undefined | P3 / D4 |
| A40 | Spectrum scope | Point/playback analysis; Scan Selection averages range | Distinct live and selection-scan modes with revision/range label | P1 / D1 |
| A41 | Spectrum snapshots | Up to eight held traces | At least eight named snapshots with configuration and source revision | P3 / D1,V1 |
| A42 | Graph presentation | Line, area, bars; log/linear; channel order/average | Separate presentation from calibrated bin data | P3 / D1,V1 |
| A43 | Resolution/reference | FFT/window controls and display reference offset | Document amplitude convention; SPL only with calibration data | P1/P3 / D1 |
| A44 | Numeric export | Frequency graph data can be copied | CSV/clipboard: Hz, level, units, estimator and window | P3 / D1 |
| A45 | Frequency readout | Hover amplitude, frequency and musical-note information | Hz plus A440-configurable note/cents; no copied ambiguous notation | P3 / D1 |
| A46 | Amplitude statistics | Peaks, min/max samples, RMS, DC, clipping | Whole-file or range computation per channel with sample locations | P1 / D3 |
| A47 | RMS histogram | Distribution with configurable window and reference | Explicit RMS window, weighting and histogram-bin definition | P3 / D3 |
| A48 | Dynamic statistics | Dynamic range, used range, loudness and perceived loudness | Name algorithms; do not equate legacy values with LUFS | P3 / D3,D5 |
| A49 | Bit-depth estimate | Reports measured waveform bit depth | Report file encoding separately from any heuristic effective-bit estimate | P3 / I1,D3 |
| A50 | Graph navigation | Zoom/pan frequency and amplitude rulers | Numeric bounds, fit, cursor-anchored ruler zoom | P3 / V1 |

## Supporting professional DSP and delivery

| ID | Feature | Documented reference behavior / evidence | Proposed Tonalia contract | Stage / verification |
| --- | --- | --- | --- | --- |
| A51 | FFT filter | Draw frequency response, window/FFT choices [A05](10-research-sources.md#a05) | Versioned response curve and latency-aware preview | P3 / D6 |
| A52 | Graphic EQ | Fixed 10/20/30-band controls [A05](10-research-sources.md#a05) | Tested band centers and gain response; publish approximation limits | P3b / D6 |
| A53 | Parametric/notch EQ | Adjustable bands and narrow rejection [A05](10-research-sources.md#a05) | Stable coefficients; gain/Q/slope limits; at least six notches | P3 / D6 |
| A54 | Filter family | Scientific filtering includes selectable responses [A05](10-research-sources.md#a05) | Later IIR/FIR designs with response and delay tests | Later / D6 |
| A55 | Gain/normalize | Amplitude processing tools [A12](10-research-sources.md#a12) | Explicit sample/true-peak normalization, no hidden limiter | P2/P3 / D3,D5 |
| A56 | Dynamics | Compression, limiting, gates/expansion and multiband options [A12](10-research-sources.md#a12) | Separate processors; timing, knee, gain and oversampling tests | P3b / D6 |
| A57 | De-essing/leveling | Speech-oriented dynamics tools [A12](10-research-sources.md#a12) | Detector transparency, split/full-band modes, preserve sibilants on bypass | P3b / R2,D6 |
| A58 | Automatic/manual pitch | Scale correction; manual contour editing [A06](10-research-sources.md#a06) | Independent pitch analysis and correction program | Later / D7 |
| A59 | Spectral pitch display | Pitch-oriented view with configurable display [A06](10-research-sources.md#a06) | Optional note grid; analysis is not an edit | P4 / D7,V1 |
| A60 | Stretch/pitch | Independent tempo/pitch; offline options [A06](10-research-sources.md#a06) | Phase-coherent transform with time-map semantics | P3b / D7 |
| A61 | Pitch bender/shifter | Envelopes and real-time pitch effects [A06](10-research-sources.md#a06) | Separately qualified duration/pitch modes; no generic drag-to-pitch claim | Later / D7 |
| A62 | Sample conversion | Rate, channel and bit-depth conversion [A07](10-research-sources.md#a07) | Explicit conversion graph; matrix channel mapping and export dither | P3 / I1,D8 |
| A63 | Effect chain | Up to 16 rack slots; reorder/bypass/presets [A08](10-research-sources.md#a08) | Ordered layers, at least 16 qualified lightweight operations | P2/P4 / D2,P2 |
| A64 | Process preview | Intensive effects processed individually offline [A08](10-research-sources.md#a08) | Versioned asynchronous renders with cancellable previews | P3 / R1,S1 |
| A65 | History | Undo, redo and history controls [A10](10-research-sources.md#a10) | Transaction log, named snapshots and reversible restoration | P2/P4 / S1 |
| A66 | Device setup | Driver, buffers, clock and channel mapping [A11](10-research-sources.md#a11) | Native device adapter, measured latency and explicit mapping | P1/P3 / I2,P2 |
| A67 | Loudness match | Target loudness, tolerance and true-peak control [A13](10-research-sources.md#a13) | Standards-versioned analysis and optional normalization/limiting | P3 / D5 |
| A68 | File output | File/selection export and format settings [A14](10-research-sources.md#a14) | Revision-pinned WAV/RF64, metadata policy, atomic output | P2/P3 / I1,S1 |
| A69 | Format import | Multiple audio/container formats [A15](10-research-sources.md#a15) | Explicit tested format table; honest rejection and metadata limits | P1/P3 / I1 |
| A70 | External effects | VST/VST3 and macOS AU scan/enable [A16](10-research-sources.md#a16) | VST3/AU later with isolated hosting; legacy VST2 deferred | Later / I3 |

## Beyond the initial reference scope

Stereo image tools, channel extraction, convolution/reverb/delay, modulation, tone/noise generation, multitrack automation, batch Favorites, frequency-band splitting, video, and surround mixing require separate detailed specifications if included later. They are not silently counted as parity. The source catalogue identifies Audition's larger effect families; this plan prioritizes spectral restoration and analysis rather than promising every DAW function in the first product.

## Behavioral ambiguities to measure before implementation claims

- Exact FFT normalization, centering, edge padding and amplitude-reference conventions in the pinned Audition build.
- Interaction between partially weighted selections and each supported effect; not every effect necessarily applies a mask identically.
- Healing behavior at stereo boundaries, silence, file edges, and the four-second reference limit.
- Selection feathering, mask resampling, spectral paste and duration/frequency transformation semantics not fully specified in the consulted pages.
- Channel-averaging conventions, statistics windowing, and frequency-snapshot persistence.
- Exact noise-profile serialization compatibility: Tonalia will use its own format; Adobe `.fft` compatibility is not promised.
- Restore quality on overlapping sources and reverberant music; public descriptions are insufficient to establish objective parity.

## Coverage expansion and claim approval

Before a broad spectral-parity release, walk every relevant menu and dialog in a pinned Audition build and reconcile the observed controls with this inventory. Add missing features and test cases, identify version-specific omissions, and record out-of-scope decisions. Store lawful measurements and original test artifacts, not redistributed proprietary assets.

A parity record must include feature IDs, build hashes, reference version, test date, input hashes, settings, result metrics, blind-listening evidence where relevant, limitations, and reviewer approval. Classify results as untested, partial, failed, verified equivalent, or intentionally excluded. A percentage based merely on implemented UI controls is prohibited.
