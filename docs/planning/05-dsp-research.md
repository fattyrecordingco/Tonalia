# DSP research and processing contracts

**Status: independent engineering proposals grounded in published methods. No DSP has been implemented or measured.**

## 1. Correct reconstruction before editing

Use an STFT as the initial analysis/edit representation. For sample rate `Fs`, window length `N`, and hop `H`, analysis frame `m` is:

`X[m,k] = Σ(n=0…N−1) x[n+mH] · wa[n] · exp(−j2πkn/N)`.

For unmodified frames, reconstruct with inverse scaling `1/N`, synthesis window `ws`, overlap-add, and local normalization:

`y[t] = Σm ws[t−mH] · IFFT(X[m])[t−mH] / Σm wa[t−mH]ws[t−mH]`.

The denominator must be nonzero for every emitted sample. A dual-window construction is an alternative; window/hop pairs require proof and tests rather than a generic claim that overlap-add always works. SciPy's ShortTimeFFT documents STFT/dual-window reconstruction and edge conventions; use it as an independent numerical oracle, not production DSP. [SciPy ShortTimeFFT](https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.ShortTimeFFT.html)

Propose periodic Hann analysis/synthesis with 75% overlap (`H=N/4`) and normalized overlap-add as the first configuration. Test `N` from 256 to 16384. Alternatives such as Hamming/Blackman are independently qualified; arbitrary user combinations cannot bypass invertibility checks. Fix global frame alignment at the source origin. Use explicit zero extension at file boundaries initially, including negative-index support frames; output exactly the source length after trimming support.

At 48 kHz, `N=2048` gives bin spacing `23.4375 Hz` and a `42.67 ms` window; `N=8192` gives `5.859375 Hz` and `170.67 ms`. `H=512` advances `10.67 ms`. These are mathematical grid sizes, not guaranteed frequency discrimination or complete device latency. Window main-lobe width, signal length and leakage also matter. Zero-padding interpolates the spectrum; it does not increase physical resolving power.

Use complex coefficients and conjugate symmetry. Real-signal DC and Nyquist bins remain real. Never resynthesize final audio from an 8/16-bit color raster or a magnitude-only thumbnail. A magnitude-only edit with discarded phase is not a complete editing engine.

## 2. Calibration and analysis units

For a bin-centered sine, one-sided peak-amplitude estimate is `2|X[k]| / Σwa` for non-DC/non-Nyquist bins; use no factor of two at those endpoints. A full-scale peak sine should read 0 dBFS peak amplitude under this convention. RMS uses its own declared convention, with a unit-peak sine at approximately −3.0103 dBFS RMS when full-scale square-wave RMS is the reference.

Power spectral density requires window-energy and sample-rate normalization and appropriate one-sided factors. Its units are power/Hz; do not label it dBFS peak amplitude. Average spectra in linear power before logarithmic conversion. Use a floor only for display/log stability; do not inject that floor into audio. Report silence as −∞ or “below display floor.”

Cursor frequency is an interpolated coordinate; peak estimation may be more precise than a bin center only under stated signal assumptions. Note display uses `69 + 12·log2(f/440)` with user-selectable tuning and cents. DC has no musical note.

## 3. Weighted selection and spectral gain

A mask `M(c,t,f)` ranges from 0 to 1. Persist geometry in source samples, Hz and explicit channel IDs, plus a rasterized/versioned representation or deterministic rasterizer configuration. Rasterization integrates coverage over processor bins/frames; do not sample only the screen pixel beneath a cursor. Mask version is independent of canvas scale.

Define initial brush composition as `Mnew = 1−(1−Mold)(1−B)` for adding a stroke coverage `B`, and `Mnew = Mold(1−B)` for erase. Union is `max`, intersection `min`, subtract is `max(0,A−B)` for explicit Boolean-region commands; name these distinct operations because their accumulation differs. Use one convention in Rust, WASM, CPU preview and GPU overlays.

For a selected gain `g` dB, propose linear wet blending:

`G = 1 + M · (10^(g/20)−1)`; `Y = G·X`.

At half coverage and full attenuation (`gain=0` linear), amplitude becomes 0.5, approximately −6.02 dB. This differs from multiplying a dB value by coverage; document it. “Mute” means zero coefficient contribution in selected bins, not guaranteed absolute silence within an arbitrarily drawn region after resynthesis.

Feathering uses separate time and frequency radii; defaults are material-sensitive proposals. Start with 5 ms time and one processor-bin frequency transition, then evaluate transient versus tonal material. Store the resolved physical radii, not “one current display pixel.” Show the finite window support. STFT editing inevitably spreads influence in time/frequency, so promise zero changes only outside the declared expanded processing support, not outside the geometric lasso edge.

Chain ordered layers in the time domain with each spectral node analyzing its actual input. This is the reference semantics. Fuse compatible adjacent gain nodes only after equivalence tests; arbitrary repair/nonlinear nodes cannot be fused by multiplying masks. Default stereo linking uses one mask/gain field across L/R while retaining original channel phase. Independent-channel editing requires explicit selection.

## 4. Repair and spectral-content editing

| Processor | Initial independent approach | Essential controls | Research/quality boundary |
| --- | --- | --- | --- |
| Local attenuation | Smooth complex STFT gain | Gain, mask, feather, channels | First editor operation; cannot separate co-located sources |
| Click repair | Candidate detection plus interpolation/linear prediction across short damaged runs | Sensitivity, min/max duration, context, channel link, exclusions | Begin with 1–10 ms defects; protect musical attacks |
| Spectral healing | Neighbor-context estimation; phase-aware interpolation/inpainting with time-domain reliable-sample constraints | Region, context direction/extent, strength, crossfade, quality | Initially restrict support; long gaps cannot be assumed recoverable |
| Spectral copy/replace | Copy aligned complex/time-domain material into a region with a defined replacement mask | Source/destination, gain, phase/time alignment, feather | P3b research; not a bitmap paste |
| Time/frequency transform | Phase-aware resynthesis with transient protection and coherent channel treatment | Time map, ratio, formants where justified, quality | Separate P3b/later program; selection movement is not pitch shifting |

Sparse inpainting literature provides candidate algorithms for reconstructing missing samples and identifies amplitude-loss issues; it does not establish that Tonalia can reconstruct a desired sound hidden behind another sound. Compare linear prediction, sparse constrained approaches and later learned candidates on identical damaged/reference pairs. [SPAIN](https://arxiv.org/abs/1810.13137), [Audio Inpainting: Revisited and Reweighted](https://arxiv.org/abs/2001.02480)

Treat healing as inference: store both candidate audio and algorithm provenance. Reliable samples outside the accepted replacement support remain untouched. Constrain iterative methods, progress/cancellation, memory and convergence. Overlapping repairs must invalidate downstream results and preserve deterministic order. Never present generated content as the recovered historical original.

## 5. Noise reduction

A noise profile estimates per-bin power distributions from a representative interval. Store sample rate, channel layout, frame/window/hop, estimator/version, range, source revision, statistics and units. A contaminated profile can remove wanted sound; show profile capture separately from applying suppression. At least 0.5 s is a proposed initial minimum, expanded when analysis requirements need more frames.

Begin research with spectral subtraction and a Wiener-style gain baseline, using measured noise power, an attenuation floor, time/frequency smoothing, and speech/transient preservation. The classic spectral-subtraction paper establishes noise-spectrum estimation and waveform resynthesis as a practical baseline, not a quality guarantee for modern restoration. [Boll 1979](https://ieeexplore.ieee.org/abstract/document/1163209/)

Proposed processor controls: maximum reduction in dB, profile threshold offset in dB, noise-floor curve, oversubtraction/strength, time smoothing, frequency smoothing, attack/release, transient preservation, channel linking, FFT configuration and residual audition. Use bounded physical ranges and independently documented semantics; Adobe's proprietary “precision” scale is not a meaningful implementation recipe.

The adaptive variant updates a noise estimator with configurable learning/freeze and stable initialization. Test leading speech, sudden noise changes, wind, tonal noise and silence. It must not learn away sustained music automatically. Link suppression decisions across stereo channels by default to protect image stability. Seeking must warm or restore estimator state; a seek must not unexpectedly change the same exported result.

Hiss reduction can expose a fixed estimated floor and a smooth threshold transfer function as a dedicated workflow. A simple DeNoise panel can map to tested settings of a qualified underlying processor. Avoid counting two panels as two independent DSP achievements.

## 6. Hum, clicks, clipping, and dereverberation

**Hum:** start with stable harmonic notch filters. Controls: base frequency (50/60 Hz presets plus free Hz), harmonic count, Q/bandwidth, attenuation, slope, channel scope, and removed-signal monitor. Never instantiate harmonics above Nyquist. Later evaluate slow frequency tracking with bounded slew; verify that wanted fundamentals are not removed without disclosure. Test impulse response, stability and phase effects, not only visible dark lines.

**Clicks/crackle:** separate detection from correction. Use robust transient features and local prediction residuals; present event bounds/confidence. Add exclusion masks, minimum spacing/run merging, detection by level, width expansion and bounded repeated scans only after false positives on percussion pass. Automatic mode uses the same qualified engine with a declared latency and conservative defaults.

**Clipping:** detect plateaus/near-threshold runs on the original referenced signal, with tolerance and minimum run length. Preserve the diagnosis before DC/level changes can hide it. Use a fast interpolation baseline and constrained reconstruction for more severe cases. Distinguish hard clipping from limiting and soft saturation. Allow reconstructed overs rather than silently clipping them again; output headroom or limiting is a separate explicit step. Severe missing peaks are not uniquely recoverable.

**Dereverberation:** evaluate WPE as one independent baseline for speech, including regularization, prediction delay, tap length and channel configuration. NARA-WPE provides offline/online reference implementations; it is not evidence of Adobe's algorithm or universal performance on music. Numerical conditioning, direct-path preservation and mono effectiveness need listening and fixture qualification. [NARA-WPE](https://github.com/fgnt/nara_wpe)

**Recurring-sound removal:** evaluate a learned spectral dictionary/event model with editable candidates, source scope and removal ceilings before a general learned separator. Success on a siren isolated in frequency does not establish success on a siren overlapping speech. Keep P3b acceptance independent from later AI promises.

## 7. Analysis and supporting processors

- **Sample statistics:** exact sample counts/locations, per-channel min/max/peak, mean/DC, RMS and histogram; deterministic treatment of silence/nonfinite data.
- **Stereo:** normalized correlation `ΣLR / sqrt(ΣL²·ΣR²)` for a declared window; show undefined near zero energy. Also provide vectorscope, mono sum and optional bandwise coherence. A negative value is a diagnostic, not a universal instruction to invert a channel.
- **Loudness:** implement the selected ITU-R BS.1770-5 algorithm/channel mapping and applicable EBU metering definitions. Qualify integrated, momentary, short-term, LRA and true-peak separately using official test vectors. Retain exact standard/version in reports; Adobe's help page can contain older references/tolerances. [ITU](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en), [EBU loudness specifications and tests](https://tech.ebu.ch/loudness/)
- **Equalization:** independently test biquad/SOS stability, response, coefficient interpolation and FIR group delay. A narrow notch can require a long settling time. A linear-phase design can introduce pre-ringing; no single filter is universally more accurate.
- **Dynamics:** detector law, attack/release, knee, oversampling, channel link and lookahead need separate contracts and test vectors. Do not disguise an unqualified limiter inside normalization.
- **Resampling:** choose a bandlimited sinc/qualified FFT implementation with known delay/tail. Verify passband and alias rejection; fast polynomial interpolation is not the default final-delivery converter. [rubato](https://docs.rs/rubato/latest/rubato/)
- **Integer export:** apply optional seeded TPDF dither only at final quantization when reducing precision. No dither for float output. Define rounding, clipping reporting, range mapping and metadata. Noise shaping is later, separately qualified work.

## 8. Latency, preview and reproducibility

Total latency includes hardware/driver buffering, queue depth, conversion, STFT support and processor lookahead. At 48 kHz a 128-frame buffer is 2.67 ms one-way buffer duration; it is not measured round-trip latency. High-resolution spectral processing may need tens or hundreds of milliseconds of lookahead even with an excellent driver.

Offer low-latency monitor mode with a qualified lightweight graph and a full-quality preview mode for spectral/offline operations. Display both latency and the active graph. Compensate latency for A/B, loop boundaries, layer bypass and export; disclose unavoidable tails. Use the same kernels for playback and offline export; caches must not change algorithm semantics.

Byte-identical results are expected for the same pinned deterministic build/platform/seed. Cross-architecture SIMD/WASM results are compared with stated tolerances unless a specially constrained deterministic renderer is selected. For AI or third-party processors, preserve the accepted rendered asset so a future software update cannot silently change the result.

## 9. First research experiments after approval

| Experiment | Decision it resolves | Evidence required |
| --- | --- | --- |
| STFT round trip across windows/hops/edges | Reconstruction defaults and supported configurations | f64 and production-precision errors; chunk/whole agreement |
| Weighted-mask sweep and boundary impulses | Brush semantics and influence envelope | Measured gain, localization and discontinuity plots |
| Profile/adaptive noise baselines | Algorithm versus artifact/CPU tradeoff | SNR/distortion, residual audio, blind preference and deadline data |
| Click/heal algorithms across gap sizes | Safe supported repair duration | Per-duration success, false positives and reliable-sample preservation |
| f32 versus f64 processing | Precision policy and resource cost | Worst-case chains, low-level audio, performance and null residuals |
| Tiled STFT/preview scheduling | Latency/memory feasibility | p50/p95 timings, cache rates, deadlines and peak memory |
| WPE/model-based removal feasibility | P3b scope and resourcing | Independent corpus results; abandon or narrow if gates fail |

None of these experiments has been run during this planning task.
