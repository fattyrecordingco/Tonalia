# Staged roadmap and engineering backlog

**All work below is future work subject to owner approval. Estimates are provisional working weeks, not dates or measured delivery velocity.**

## Staffing and schedule assumptions

Assume approximately five full-time equivalents: two DSP/restoration specialists, one Rust/audio systems engineer, one frontend/graphics engineer, and half-time QA plus half-time product/design. Security, platform signing, accessibility and independent listening expertise require additional part-time support at relevant stages. Hiring and procurement time are excluded.

The phase ranges describe elapsed time with this staffing, existing professional audio experience, and workstreams proceeding in parallel within a phase. They are not sums of all backlog item effort. Local quality gates remain on the critical path. The full staged vision totals **75–127 weeks**, with a recommended **25% uncertainty reserve**, approximately **22–37 months**. A one- or two-person effort should be re-estimated from capacity and specialist availability rather than retaining these dates. Do not promise a professional Audition-equivalent release in a few weeks.

| Stage | Duration | Deliverable and dependencies | Exit criteria / evidence |
| --- | --- | --- | --- |
| P0 — Research and feasibility | 3–5 weeks after approval | Reference measurement, fixtures, shell/device/FFT experiments; this desk-research package is already prepared | Pin Audition build; reconcile matrix; prove reconstruction; choose shell; freeze test hardware and scope; owner reviews findings |
| P1 — Working spectral viewer | 6–10 weeks | Native decode/playback, tiled calibrated spectrum/waveform, selection coordinates and basic analysis; needs P0 | I1/I2,D1,D3,V1,P1/P2 viewer subsets pass; 1-hour stereo file handled without whole-file RAM load; no editing/parity claim |
| P2 — Functional spectral editor | 10–16 weeks | Mask tools, actual gain/attenuation, minimal layers, undo, project save/recovery and WAV export; needs P1 | E1,D2,S1 pass; production reconstruction bounds pass; reopen/export reproduces same revision; eight-editor formative session |
| P3 — Professional restoration | 20–36 weeks | P3a core restoration 12–20 weeks; P3b advanced work 8–16 weeks; needs P2 and DSP research gates | R1–R6/D4–D8/I1 professional subsets pass per shipped tool; unsupported tools remain partial/deferred in matrix |
| P4 — Figma-like workflow | 8–12 weeks | Rich layer management, inspector, saved views, intelligent selection, snapshots and comparison; needs reliable P3 core | U1,V1,P1,S1 pass; ≥80% independent workflow completion; accessible controls and complete render-state handling |
| P5 — Collaboration | 12–20 weeks | Shared semantic transactions, asset transfer, review/comments, permissions and offline branches; needs stable schema/P4 | C1 and security/recovery tests pass at ten editors/project; no lost acknowledged edits or unplayable accepted revisions |
| P6 — AI assistance | 16–28 weeks | Model/rights evaluation, isolated inference, reversible candidates and quality studies; needs P3 quality corpus/P5 provenance | A1 pass for each model/domain; preserve accepted assets; candidate quality beats selected baseline without hidden changes |

P0–P2 yields a real local editor in **19–31 weeks** before reserve. P0–P3 yields a candidate professional restoration release in **39–67 weeks** before reserve, provided the particular shipped tools pass; difficult P3b algorithms may remain deferred. P3b work is never used to block shipping a clearly scoped, tested P3a product, and P3a must not claim complete restoration parity.

## Milestone demonstrations

1. **M0: evidence and risk review.** Show sourced feature coverage, calibrated transform plots, shell/device results and revised estimates. Record every feasibility failure.
2. **M1: working viewer.** Open an unfamiliar real recording, navigate to a narrow tone, read its frequency/amplitude, play correct stereo, and maintain responsiveness while analyzing the rest.
3. **M2: real editor.** Paint a region, hear a measured attenuation, save/reopen, undo, export and null-test against the expected render. Kill/restart during save to demonstrate recovery.
4. **M3a: usable restoration.** Treat held-out hiss/hum/click/clipping cases with original/result/residual previews and evidence. Deliver a limitations report and repeatable output files.
5. **M3b: advanced capability review.** Compare healing, dereverberation and recurring-event suppression against pinned reference and independent baselines. Narrow or defer any failed tool.
6. **M4: workflow beta.** A practicing editor completes a timed repair and version comparison without developer guidance; record intervention counts and latency.
7. **M5: shared project.** Two users overlap repairs, disconnect, reconnect and resolve a conflict; ten-user load, asset loss, permission revocation and server restart tests also pass.
8. **M6: AI evaluation.** Generate and reject/accept a candidate; reopen it after changing the installed model; demonstrate unchanged accepted sound and document data/model rights.

A polished screenshot or canned animation cannot satisfy any milestone. Every demo includes real audio, build identity, fixture identity and observed limitations.

## Backlog conventions

Priority `0` blocks that stage; `1` is required for the stage's complete scoped release; `2` is an optional enhancement. Sizes are **relative complexity**: S (up to a few focused days), M (about one to two engineer-weeks), L (multiple weeks/research); these are not additive calendar commitments. Role codes: SYS (Rust/audio), DSP, UI (frontend/graphics), QA, PROD, COL (collaboration/security), ML. Test-family IDs refer to [08](08-testing-and-verification.md).

### P0 — Evidence and feasibility

| ID | Work package / concrete output | Pri / size / owner | Dependencies and acceptance |
| --- | --- | --- | --- |
| RES-01 | Pin licensed Audition build and record all relevant controls/edge cases | 0 / M / PROD+QA | Approved research; A01–A70 each mapped to observed/unknown/excluded |
| RES-02 | Create corpus manifest and independent reference-analysis plan | 0 / M / DSP+QA | Rights recorded; sample rates/channels/length/damage classes covered |
| RES-03 | Measure native device and shell candidates | 0 / M / SYS+UI | I2,P1/P2; choose one shell with measured rationale |
| RES-04 | Prototype numerical experiments outside production app | 0 / M / DSP | D1/D2 round-trip and calibration meet gates; report precision limits |
| RES-05 | Approve scope, licences and platform baseline | 0 / S / PROD+SYS | RES-01–04; decision log and revised schedule accepted |

### P1 — Working spectral viewer

| ID | Work package / concrete output | Pri / size / owner | Dependencies and acceptance |
| --- | --- | --- | --- |
| ENG-01 | Define checked units, channel layouts and protocol schemas | 0 / M / SYS | RES-05; malformed ranges/unsafe integer conversions rejected |
| MED-01 | Stream WAV decode and chunked PCM cache | 0 / M / SYS | ENG-01; I1 exact values/seek/channel tests |
| AUD-01 | Native playback, transport and device errors | 0 / L / SYS | MED-01; I2/P2 viewer gates; UI stalls do not stop audio |
| DSP-01 | STFT calibration and independent inverse reference | 0 / M / DSP | RES-04; D1/D2 across boundaries and configurations |
| VIS-01 | Peak pyramids and tiled magnitude cache | 0 / M / DSP+SYS | MED-01,DSP-01; P1 memory bound and honest LOD labels |
| VIS-02 | GPU canvas, transforms, rulers and fallback | 0 / L / UI | VIS-01; V1/P1; loss of GPU leaves playback working |
| UI-01 | Open source, inspect metadata, time range and markers | 1 / M / UI | ENG-01,VIS-02; keyboard/numeric selection routes |
| ANA-01 | Live/scan spectrum, peaks/RMS/DC statistics | 1 / M / DSP+UI | DSP-01; D1/D3 and revision/range labels |
| QA-01 | Viewer CI and real-platform benchmark reports | 0 / M / QA | All viewer work; M1 evidence published internally |

### P2 — Functional spectral editor

| ID | Work package / concrete output | Pri / size / owner | Dependencies and acceptance |
| --- | --- | --- | --- |
| DOC-01 | Versioned graph/document, command IDs and preconditions | 0 / L / SYS | ENG-01; graph validation and deterministic state hash |
| SEL-01 | Rectangle/lasso and channel-aware numeric bounds | 0 / M / UI+DSP | DOC-01,VIS-02; E1 CPU/overlay agreement |
| SEL-02 | Brush rasterization, opacity, feather, erase and pressure | 0 / L / UI+DSP | SEL-01; E1/D2 including changed zoom and log ruler |
| DSP-02 | Actual masked gain/attenuation with iSTFT | 0 / L / DSP | DSP-01,SEL-02; D2 gain/localization/edge tests |
| ENG-02 | Prepared graph, render scheduler and stale-job cancellation | 0 / L / SYS | DOC-01,DSP-02; P2 and revision switching tests |
| UI-02 | Minimal ordered layers, inspector and bypass | 0 / M / UI | DOC-01,ENG-02; E1 order and explicit audio/overlay controls |
| AUD-02 | Original/result/selection/residual comparison | 0 / M / SYS+DSP | ENG-02; D2 latency alignment and residual contract |
| PRJ-01 | SQLite journal, assets, save/reopen and migrations | 0 / L / SYS | DOC-01; S1 crash recovery and source hashes |
| PRJ-02 | Undo/redo and repair-safe snapshots | 0 / M / SYS+UI | PRJ-01; S1 one transaction per gesture |
| EXP-01 | Revision-pinned PCM/float WAV export | 0 / M / SYS | ENG-02,PRJ-01; I1/D2/S1; no silent device-rate conversion |
| QA-02 | Formative workflow and damage/recovery validation | 0 / M / QA+PROD | P2 work; M2 evidence and release blockers recorded |

### P3 — Professional restoration

| ID | Work package / concrete output | Pri / size / owner | Dependencies and acceptance |
| --- | --- | --- | --- |
| RST-01 | Profile capture/persistence and denoise baseline | 0 / L / DSP | P2,R2 corpus; R2 plus S1 profile provenance |
| RST-02 | Adaptive/hiss workflows and simple DeNoise panel | 1 / L / DSP+UI | RST-01; R2 seek-state/leading-speech tests |
| RST-03 | Harmonic hum removal and residual monitoring | 0 / M / DSP | DSP-02; R3 response/drift/channel tests |
| RST-04 | Click detection, event list and selective repair | 0 / L / DSP+UI | P2; R1 false positives and event revision binding |
| RST-05 | Constrained clipping repair and diagnosis preservation | 0 / L / DSP | RST-04; R4 reliable samples/headroom tests |
| RST-06 | Small-gap/spot healing candidates and context | 0 / L / DSP | RST-04,ENG-02; R1 duration envelope and independent listening |
| ANA-02 | Correlation, vectorscope, histograms and snapshots | 1 / M / DSP+UI | ANA-01; D3/D4 and undefined-silence handling |
| ANA-03 | Standards-based loudness/LRA/true-peak metering | 0 / L / DSP+QA | D5 official vectors; no standards claim before pass |
| DSP-03 | EQ/notches, conversion, dither and final headroom | 0 / L / DSP | D6/D8/I1; physical response and final quantization tests |
| MED-02 | Complete baseline formats/rates and RF64 | 0 / M / SYS | EXP-01; I1 >4 GiB, all published support combinations |
| RST-07 | Silence detection, mark/mute/shorten | 1 / M / DSP+UI | DOC-01; R6 explicit timeline mutation and undo |
| RST-08 | Advanced click/pop controls and bounded scans | 1 / L / DSP | RST-04; P3b R1 held-out attacks/crackle |
| RST-09 | WPE/dereverberation feasibility and processor | 1 / L / DSP | R5 corpus; stop/narrow if research gates fail |
| RST-10 | Recurring-sound model learning and removal | 1 / L / DSP | R5; accepted candidates, no unsupported separation claim |
| DSP-04 | Spectral copy/replace and time/pitch research | 1 / L / DSP | D7, explicit mapping/phase contracts; partial until verified |
| DSP-05 | Advanced dynamics, graphic EQ and de-essing | 1 / L / DSP | D6/R2; separate processors and response tests |
| QA-03 | Blind reference comparison and professional release report | 0 / L / QA+PROD | Shipped processor tests; M3a/M3b evidence; parity exceptions visible |

### P4–P6 — Workflow, collaboration and AI

| ID | Work package / concrete output | Pri / size / owner | Dependencies and acceptance |
| --- | --- | --- | --- |
| UX-01 | Groups, reorder, rich inspector, saved views and palette | 0 / L / UI | Stable P3; V1/U1; no decorative inactive controls |
| UX-02 | Harmonic/ridge/transient selection suggestions | 1 / L / DSP+UI | E1 labelled corpus; median mask IoU ≥0.75 on declared subset, no auto-apply |
| UX-03 | Named revisions, comparison and reusable chains | 0 / L / SYS+UI | S1 and U1; old/current revisions audibly reproducible |
| UX-04 | Keyboard/accessibility and platform interaction audit | 0 / M / UI+QA | U1; core tasks accessible without canvas pointing |
| COL-01 | Authenticated semantic transaction service | 0 / L / COL | Stable schema; C1 valid order/idempotency/permission tests |
| COL-02 | Offline branches, conflicts and scoped undo | 0 / L / COL+SYS | COL-01; C1 randomized network/reconnect tests |
| COL-03 | Resumable verified assets and playable revision commit | 0 / L / COL | COL-01; C1 no acknowledged missing dependencies |
| COL-04 | Presence, comments, review links and optional follow | 1 / M / COL+UI | COL-01–03; no unexpected remote playback/device changes |
| COL-05 | Operational backups, quotas, security and load qualification | 0 / L / COL+QA | C1 ten-editor and recovery gates; independent review |
| AI-01 | Select model/domain and establish code/weight/data rights | 0 / L / ML+PROD | Quality corpus; written model card and licence decision |
| AI-02 | Isolated local/cloud inference with versioned candidates | 0 / L / ML+SYS | AI-01,PRJ-01; A1 cancellation and accepted asset provenance |
| AI-03 | Blind quality/preservation and out-of-domain evaluation | 0 / L / ML+QA | AI-02; A1 per-domain release gates |
| AI-04 | Candidate review UI and model-update compatibility | 1 / M / UI+ML | AI-03; no overwrite; reopened output unchanged |

## First implementation increment, only after approval

Start with RES-01–05. The first ten working days should produce a pinned reference version, corpus/rights manifest, STFT/precision measurements, native playback timing and a Tauri-versus-Electron compatibility report. The next implementation commitment is a viewer whose audio and measurements can be independently checked. Do not spend this increment on a marketing site, elaborate branding, collaboration infrastructure or unverified AI demos.

## Definition of done and stop/replan rules

Each work package requires its stated evidence, reviewed contracts, supported-platform results, documented limitations and reproducible build/fixture identifiers. Audio-changing code needs independent numerical evidence plus listening where a numerical threshold is insufficient. Reversible cosmetic changes do not require artificial unit tests.

Stop/replan an algorithm when it cannot meet preservation and quality targets after its bounded experiment budget; narrower honest scope is preferable to a hidden failing control. Re-estimate after P0, P2 and every P3b research decision. No downstream feature compensates for source loss, wrong channels, reconstruction errors or untrustworthy export. Owner approval is required before application implementation begins; this task ends with planning.
