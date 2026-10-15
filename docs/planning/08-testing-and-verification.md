# Testing, performance and parity verification

**Proposed acceptance criteria, not test results. No application tests or benchmarks have been run during planning.**

## Evidence model

Test mathematical contracts independently of the implementation, using analytic signals, separately written SciPy/NumPy calculations, official standards vectors and lawful real recordings. Never approve audio quality because a spectrogram looks cleaner. Store machine-readable measurements, original rendered test audio, manifests and concise review reports with the build.

Each result records build/commit, compiler/dependency versions, OS/runtime/GPU/driver, device/backend/buffer, sample format/rate/layout, source hash, graph/mask configuration, seed, precision, warm/cold cache state and measurement method. Distinguish unit, integration, hardware, listening and user-study evidence.

## Corpus and coverage

Synthetic fixtures: silence, DC, impulses at boundaries, bin-centered/off-bin tones, sweeps, white/pink noise, near-Nyquist content, polarity-inverted/uncorrelated stereo, float overs, low-level signals, integer extremes, hard/soft clipping and known damaged gaps. Vary file length from zero/one sample through just below/above each window/hop/chunk boundary.

Real fixtures: dialogue in quiet/noisy/reverberant rooms, breath/sibilance, unvoiced speech, sustained instruments, percussion/cymbals, dense stereo music, hum with drift, archival hiss/crackle and ambience. Include at least 60 minutes of clean material for false-positive testing and a held-out restoration set with at least 30 clips per declared problem class. Record rights; customer audio is not automatically a shareable fixture.

Partition by source recording/speaker/session, not randomly adjacent frames. Training/tuning data cannot leak into the acceptance set. Create known-reference mixtures and damages for quantitative tests, plus real faults for listening. Label naturally damaged material as lacking ground truth. Maintain complete mono/stereo × six baseline rates × four baseline WAV sample encodings for professional import/export qualification; test supported conversions and unknown-channel layouts separately.

## Test families and gates

| ID | Subject | Proposed measurable acceptance |
| --- | --- | --- |
| I1 | Decode, seek, metadata and export | PCM values match independent decode exactly in an adequate precision; correct frame count/channel order/rate; seek error 0 samples on lossless formats; RF64 >4 GiB passes; unsupported profiles reject clearly |
| I2 | Device I/O | Correct device/channel/rate negotiation, loopback routing and clock reporting; loss/reconnect handled without source mutation; supported interface matrix recorded |
| I3 | Later plugin integration | Scanner crash isolation, state save/reopen, latency/tail and channel tests; failed/missing plugin never silently omitted |
| D1 | Spectral calibration | Bin-centered sine peak error ≤0.05 dB; bin center error ≤0.01 bin; window/bin spacing correct; PSD integrated power agrees within 0.1 dB; silence/DC/Nyquist and LOD cases pass |
| D2 | Reconstruction and edits | f64 reference max absolute no-op error ≤1e−12 for normalized fixtures; production f32 normalized RMS error ≤1e−6 (−120 dB), max absolute ≤5e−6; same error bounds across chunk/whole renders; no nonfinite output |
| D3 | Statistics | Analytic peak/DC/RMS within 1e−6 normalized amplitude or 0.01 dB for finite values above test floor; exact counts and sample locations; sine RMS convention explicitly tested |
| D4 | Stereo/phase | Identical signals ≥0.999 correlation; inverted ≤−0.999; selected seeded uncorrelated fixture `abs(r)`≤0.05; silence marked undefined; mono routing and vectorscope axes verified |
| D5 | Loudness and true peak | Pass all applicable official BS.1770/EBU vector tolerances; internal comparison targets ≤0.1 LU and ≤0.2 dBTP where reference certainty permits; channel weights/gates/reset/timing verified |
| D6 | Filters and dynamics | EQ steady-state gain error ≤0.1 dB in declared passband; stable poles and bounded outputs; compressor curve error ≤0.2 dB outside knee; timing within 5% of defined detector response; no automation clicks |
| D7 | Pitch/time transforms | Output length within 1 sample of specified mapping; steady-tone pitch within 2 cents on declared supported range; phase/channel/transient preservation and listening gates pass |
| D8 | Conversion/dither | Final-quality SRC passband ripple ≤0.01 dB and stopband rejection ≥100 dB in the profile's explicitly declared bands; delay/frame counts correct; seeded dither repeatable, approximately zero mean with expected distribution/no tonal bias |
| E1 | Selection and manipulation | Same physical mask after zoom/pan/palette changes; CPU reference raster matches accepted coverage within 1/255; channel scope exact; 1000 repeated transforms stay within 1 sample and 0.1 bin of saved bounds |
| S1 | Persistence/history | Source hashes unchanged; save/reopen identical canonical graph; deterministic same-build render hash; every acknowledged transaction survives injected crash; undo/redo 10,000 commands and migration/corruption/disk-full tests pass |
| V1 | Canvas/UI correctness | Rulers/cursor/overlays agree within 0.5 CSS px; no wrong-revision display; keyboard/numeric controls work; GPU loss and fallback preserve current view and audio state |
| P1 | Display and memory performance | Performance table below; bounded caches and responsive cancellation on long recordings |
| P2 | Audio scheduling performance | Deadline/latency table below; no callback allocation/locks/I/O; UI/analysis load cannot interrupt qualified playback |
| R1 | Clicks/healing | Detect ≥90% of defined injected clicks at specified amplitudes/durations; ≤0.1 false repair/min on clean held-out material; short-gap median reconstruction SNR improves ≥6 dB versus damaged signal; preservation/listening pass |
| R2 | Noise/hiss/adaptive | On declared additive-noise fixtures: noise-only power reduced ≥8 dB, median SI-SDR improves ≥5 dB, clean-input level error ≤0.5 dB; held-out speech/music preservation and listening pass |
| R3 | Hum | ≥30 dB reduction of declared stationary harmonic fixtures; wanted tones outside published notch transition change ≤0.1 dB; drift envelope separately measured; no unstable state |
| R4 | Clipping | For fixtures clipped 3–6 dB: median reconstruction SNR improves ≥6 dB; unmarked samples outside crossfade support unchanged; no nonfinite output/reclipping; severe cases reported separately |
| R5 | Advanced restoration | Dereverb: ≥3 dB median reduction of labelled late-reverb energy in declared convolved-speech set, direct component level within 1 dB; recurring-event removal: ≥6 dB median event reduction with wanted-component SI-SDR degradation <1 dB; independent listening also passes |
| R6 | Silence operations | Declared level/duration boundaries agree within one analysis hop; mark/mute preserve length exactly; shorten changes it by exactly accepted sample count; channel and undo behavior pass |
| U1 | Workflow/accessibility | ≥80% of eight-editor cohort completes core workflow after ≤10 min orientation without help; keyboard-only workflow succeeds; focus, screen-reader summaries, contrast and scaling audit passes |
| C1 | Collaboration | Ten editors: zero divergent accepted graphs/assets in 10,000 seeded mutation/failure sequences; command ACK p95 ≤300 ms at 50 ms RTT; all permission/duplicate/reconnect/branch tests pass |
| A1 | AI candidates | Same accepted asset reopens bit-identically after model update; no unauthorized upload; held-out domain listening beats selected baseline with lower 95% preference confidence bound >50%; no failed preservation gate hidden by average quality |

For D2, normalized RMS error means `RMS(output−reference)/RMS(reference)`, tested on nonsilent signals; evaluate silence with absolute error. A true no-op bypass at the same encoding/rate, with no conversion/dither, must preserve decoded samples exactly and avoid unnecessary STFT work. Do not confuse a bounded numerical STFT round trip with byte-identical container metadata.

For masked gain, verify full coverage gain within 0.1 dB on steady in-band tones, half-coverage behavior against the specified linear blend, and no edit outside the declared expanded time support. Test unselected frequencies sufficiently far outside window/feather transition; do not require physically impossible perfect brick-wall localization. Pin padding, frame origin and overlap so chunk borders cannot change sound.

R1/R2/R4/R5 values are proposed **scope gates**, not universal performance guarantees. P0 must freeze corruption amplitude, gap length, mixture SNR, RT60, source classes and component-estimation method before algorithm tuning. If a tool cannot pass, narrow its supported domain or defer it. R5 component measures require synthetic labelled mixtures and cannot alone certify natural recordings.

## Benchmark environments

Qualify two reference systems at minimum: Windows 11 x64, Intel i5-1240P class CPU/integrated graphics, 16 GiB RAM/NVMe; and Apple M2 class macOS system with 16 GiB/NVMe. Freeze exact available hardware/OS builds in P0 and report actual specifications, not these classes as measurements. Add a higher-channel-count USB interface with qualified CoreAudio and Windows ASIO/WASAPI drivers, plus built-in output tests. Test power-saving and thermal-load behavior separately.

Use 1440×900 viewport at 60 Hz, foreground app, AC power, release builds and recorded background load. Run at least five warm repetitions after warmup and five cold starts; report p50/p95 and worst relevant event. For frame times collect thousands of frames, not just five observations. Absolute targets apply to the frozen reference systems; lower-end hardware gets an explicit support/performance report.

| Operation | Proposed target | Conditions |
| --- | --- | --- |
| First audible playback | ≤500 ms warm, ≤2 s cold | Local supported WAV, valid device already selected, no expensive pending graph |
| First useful spectral viewport | ≤2 s | One-hour 48 kHz stereo WAV; cold derived cache; show progressive extent |
| Warm pan/zoom | p95 ≤16.7 ms/frame | Visible tiles cached; p99 ≤33.3 ms; missing tiles visibly pending |
| Brush overlay response | p95 ≤30 ms | One active stroke; no synchronous full audio render |
| Warm playback seek | p95 ≤100 ms | Prepared graph/ring data; expensive state restoration shown separately |
| Lightweight parameter audibility | p95 ≤50 ms plus measured I/O latency | Supported live node; smoothing and graph preparation included |
| Small spectral preview | ≤500 ms preparation | Two-second region, one gain node, N=2048; full-quality render |
| Initial short-heal preview | ≤2 s | 100 ms selected span plus declared context; qualified local algorithm |
| Simple export | ≥5× real time | 48 kHz stereo, one spectral gain node, no conversion/AI; report heavier chains separately |
| Memory | ≤1 GiB process working set, ≤256 MiB GPU cache | One-hour stereo viewer; cache budgets enforced; source excluded from RAM by streaming |
| Long-session stability | No unbounded growth; ≤10% post-warmup increase after eviction cycles | Four-hour soak with open/close/seek/edit/cache churn; record retained assets separately |
| UI independence | Zero audio xruns during repeated 1 s UI stalls | Qualified playback graph; background analysis/export enabled within scheduled limits |
| Callback deadline | p99.99 compute time <50% block duration; no xruns in 60 min | 48 kHz/256-frame baseline negotiated configuration; 128-frame pro-interface case separately qualified |
| Lightweight loopback latency | p95 ≤20 ms | 48 kHz/128-frame requested on qualified wired interface; measured physical loopback, not buffer arithmetic |

A high-resolution/offline spectral graph is excluded from the lightweight loopback promise and must display its measured lookahead/queue contribution. Performance gates are re-evaluated when graphs, files or platform support expand; a fast one-node result does not prove a 16-layer restoration chain is live-capable.

## Listening study design

Use randomized, double-blind comparisons with clean reference when one exists, damaged input, selected baseline, Tonalia candidates and pinned Audition output. Match listening level within 0.1 dB where appropriate, align delay, prevent clipping and allow short repeated segments. Include quality, remaining fault, speech intelligibility, transient damage, stereo image and preference ratings.

At least 12 trained listeners and 20 held-out clips per studied processor are an initial release-study target; pilot variance determines whether more data is needed. Use participant- and clip-aware confidence intervals rather than treating every click as an independent listener. Predefine exclusions and analysis. For large impairments use an appropriate multiple-stimulus approach; for subtle damage use a small-impairment comparison. Do not claim formal ITU compliance unless the study actually follows the entire procedure. [ITU BS.1116](https://www.itu.int/rec/R-REC-BS.1116-3-201502-I/en), [BS.1534](https://www.itu.int/rec/R-REC-BS.1534/en)

For reference-equivalence quality claims, pre-register a non-inferiority margin of 5 points on a declared 0–100 quality scale; the lower 95% confidence bound on Tonalia-minus-reference must exceed −5 in the claimed domain, with no failing critical preservation case. If the study is underpowered or the reference result unavailable, report inconclusive/partial. A preference majority alone is insufficient to claim every reference capability.

## Failure and adversarial verification

Fuzz decoders, manifests, masks and graph commands; use malformed/oversized archives, pathological polygons, compressed expansion, invalid rates/layouts and overflow coordinates. Run sanitizers where applicable, allocation/deadline instrumentation, property-based graph tests and cancellation races. Crash at transaction/asset-write boundaries; inject disk-full, read-only paths, missing devices, stale renders, inaccessible media and failed migrations.

Collaboration simulations reorder/drop/duplicate messages, partition users, race delete/edit/reorder, revoke roles during transfers, restart server, replay old commands and forge unauthorized asset IDs. Restore cloud snapshots and logs in a clean environment. AI/plugin failures include hung inference, out-of-memory, corrupt weights, changed model versions and unavailable processors.

## CI and release workflow

- Each code change: relevant numerical/unit/integration suites and graph/schema/static checks; no test suite is implemented in this planning task.
- Nightly: extended numerical corpus, CPU/WASM agreement, randomized graph/network tests, fuzz smoke and desktop UI smoke on available platform runners.
- Scheduled hardware lab/release candidates: device latency, xruns, GPU loss, large-file tests, soak and signed installer upgrade/recovery.
- Before audio quality claims: held-out corpus report, blind study, reviewed exceptions and matrix update.

Release requires no unresolved source corruption, wrong-channel edit, missing acknowledged transaction, nondeterministic same-build deterministic export, unauthorized media access or silent omission of processors. Performance regressions above 10% against the frozen baseline require explanation and an explicit revised support decision. Every published capability has a test record; “verified equivalent” is granted per feature/platform/domain rather than by blanket product assertion.
