# Tonalia product specification

**Status: proposed · Owner: Fatty Recording Co · Research date: 15 October 2026**

## Product promise

Make frequency content editable with the clarity of objects on a canvas, while preserving the accuracy and trust expected of professional audio software. Every visible control must correspond to an audio operation, a measurement, or an intentional workspace action. An animated spectrogram alone is not the product.

The primary users are dialogue editors repairing local faults, restoration engineers treating archival recordings, sound designers manipulating spectral material, and mixing/mastering engineers investigating tonal and stereo problems. Reviewers and collaborators become secondary users after local work is reliable.

## Core jobs and end-to-end contracts

| Job | User journey | Successful outcome |
| --- | --- | --- |
| Remove a narrow whistle | Import → zoom → paint/lasso → audition selection → attenuate → A/B → export | Reversible attenuation with correct channel scope and no unexplained timing shift |
| Repair a click | Identify transient → inspect waveform → request healing → hear original/result/removed material → accept | Repair becomes a named operation; source and previous result remain available |
| Reduce constant hiss | Select representative noise → capture profile → select treatment range → tune reduction and preservation → export | Profile provenance and processing settings persist; no promise of perfect isolation |
| Find a phase problem | Select channel pair → correlation/vectorscope → mono monitor → polarity or alignment operation | Measured change and its audible consequence are linked; silence is not reported as perfect correlation |
| Compare treatments | Duplicate a layer group → vary settings → matched A/B → named revision | Level matching is a monitor-only choice unless an explicit gain operation is created |
| Review with a client | Share authorized revision → anchor a comment to time/frequency → suggest an alternative | The reviewed revision is identifiable; accepting a suggestion is explicit |

## Domain distinctions

**Source** is immutable media. **Asset** is a source or an immutable derived result with a content hash. **Clip** references source samples with a timeline mapping. **Selection** is a temporary weighted region. **Mask** is a persisted region attached to an operation. **Layer** organizes one or more processing operations. **Revision** identifies a complete document state. **Cache** accelerates work and is disposable.

A layer can contain attenuation, gain, noise suppression, or a repair replacement. Layer order determines processing order; changing the order may change the result. A spectral layer is not a separate isolated instrument, and overlapping sounds cannot generally be separated merely by selecting a pixel. Visibility of an overlay and enabling its audio operation are separate controls.

## Scope by release

### Viewer milestone P1

Actual mono/stereo PCM WAV decode and playback, original-rate metadata, channel mapping, calibrated waveform/STFT, numeric cursor, independent time/frequency zoom, markers, overview, spectrum, sample peak/RMS/DC statistics, and bounded-memory navigation. No export of edited sound is implied.

### Editor milestone P2

Time/frequency ranges, rectangles, lasso, brush, feathering, channel targets, numerical selection editing, audition modes, spectral gain/attenuation, source-preserving trim/copy/mute, a minimal ordered layer stack, transactional undo/redo, save/reopen, recovery, and WAV export. Basic original/result comparison is mandatory. Repair tools arrive only when their DSP passes P3 gates.

### Professional local release P3/P4

P3 first qualifies core restoration and professional metering. Advanced dereverberation, learned recurring-sound removal, detailed click/pop processing, time/pitch transformation, and multichannel support have their own gates and can ship later. P4 qualifies the complete layer/inspector/history workflow. A restricted initial release must publish its exact capability list and outstanding reference-matrix items.

Baseline import/export targets: WAV PCM 16/24/32 integer and 32-bit float; 44.1, 48, 88.2, 96, 176.4, and 192 kHz. Process a 32-bit integer source in f64 if preserving all its decoded bits is required; never silently truncate it through f32. Qualify FLAC and AIFF afterward; lossy formats are convenience import/export work, with encoder delay, padding, metadata, licensing, and supported-platform tests. RF64 and files exceeding 4 GiB must pass before claiming long-form professional support. Never resample a source on import without an explicit operation.

P1/P2 qualification starts with mono/stereo 44.1/48/96 kHz and PCM 16/24/float32; remaining baseline combinations are P3 release gates. A development milestone is narrower than the published professional support matrix.

### Deferred scope

General multitrack DAW arrangement, MIDI sequencing, instrument hosting, surround mixing/panning, video editing, AAF/OMF interchange, CD authoring, broadcast automation, and mobile editing are separate product programs. Channel-aware spectral editing of a multichannel file is a different requirement from surround mixing. VST3/AU hosting is an optional later desktop program; VST2 is excluded initially. Deferred work remains visible in the parity matrix instead of being called complete.

## Original Tonalia capabilities

- Nondestructive masks with named operations, layer order, bypass, group enable, and reproducible versions.
- Intelligent selection proposals based on visible ridges, harmonics, and transient boundaries; an inspectable confidence overlay and manual refinement remain available.
- Contextual previews with original, result, selected content, residual, and mono monitor modes.
- Linked waveform, spectral, numerical, stereo, and loudness inspection of the same revision.
- Time/frequency comments, review branches, durable revision links, and per-user undo when collaboration is introduced.
- Optional AI that proposes candidates on a separate layer and records the exact model, source, settings, and accepted output.

These are Tonalia design proposals, not statements about features absent from other products.

## Product invariants

1. A display preference cannot change exported audio.
2. Pointer gestures resolve to physical time/frequency/channel coordinates; changing zoom cannot move a saved edit.
3. The UI identifies the rendered audio revision and never silently plays stale repairs as current.
4. Edits preserve duration unless a duration-changing command explicitly says otherwise.
5. Export captures a complete immutable revision; ongoing edits cannot change its result midway.
6. Project corruption, missing media, unavailable processors, and unsupported versions have recoverable states.
7. Local editing remains available offline; uploading audio requires a deliberate shared-project or cloud-job action.
8. Every quality tier has a disclosed purpose; a fast preview cannot quietly become the final render.

## Product evaluation

Recruit at least eight working editors across dialogue, archive, and music workflows. At P4, at least 80% should complete import → select fault → preview → revise → export without assistance after a ten-minute introduction. Median task completion should improve by at least 20% over the participant's initial Tonalia session; comparison with Audition is reported separately with experience and learning effects controlled. No unresolved loss-of-work defect may remain in a release candidate.

The brand is **Tonalia — developed by Fatty Recording Co.** Use original terminology, layout details, graphics, icons, and written help. Research published behavior and mathematical methods; independently implement and validate them. Brand/trademark clearance for the name is an unresolved business task, not an established result of this research.
