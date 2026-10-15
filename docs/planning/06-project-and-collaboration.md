# Project model, history, collaboration and AI

**Status: proposed contracts. Local reliability precedes network collaboration.**

## Source-preserving project format

Use a writable working project directory managed outside consumer sync folders while open. Propose a `.tonalia` portable snapshot as an atomic archive of manifest, project metadata and selected immutable assets. A directory-backed project may be supported for very large media; the extension/container decision is finalized in P0 after recovery and file-system experiments.

The working store contains a versioned SQLite database for document metadata/journal, immutable assets, and rebuildable caches. Store accepted repairs/AI outputs under assets, not cache. A portable snapshot contains only committed state and a consistent database backup; never zip an actively mutating SQLite database and assume consistency. Active project folders copied by OneDrive or similar software are not a transaction/sync protocol.

| Entity | Required data |
| --- | --- |
| Project | UUID, schema version, engine compatibility, timeline rate, creation/author metadata, current revision |
| Source | Byte hash, decoded-content identity/version, original format/rate/frames/layout, import metadata, embedded/reference policy |
| Clip | Source ID, half-open source range, timeline position/rational mapping, explicit conversions |
| Mask | ID/version, channels, time/Hz geometry, feather, rasterizer version, immutable stroke/coverage chunks |
| Operation | Processor ID/version, input dependencies, mask ID, parameters/units, seed, precision, latency/context policy |
| Layer/group | Stable ID, name, ordered child/operation references, enabled state, local locks and overlay preferences |
| Revision | Parent revision(s), canonical state/dependency hash, command IDs, author, time, accepted asset references |
| Noise profile | Capture source/revision/range, sample/configuration metadata, statistics, estimator version |
| Marker/comment | Stable ID, source/sample/frequency anchor, revision context, text, author and resolution state |
| Derived asset | Content hash, exact input revision, processor/model identity, settings and accepted PCM |
| Cache record | Rebuildable content-key, byte size, integrity, backend/precision and eviction metadata |

All sample coordinates use checked integers; UI seconds are formatted views. Hash canonical serialized data with a fixed schema/order and normalize nonfinite/invalid parameters by rejecting them. Distinguish identical encoded bytes from equivalent decoded PCM so decoder upgrades cannot silently reuse incompatible results.

## Transactions and history

Every edit has a command ID, base revision, preconditions, semantic payload and inverse or revision restoration data. A brush stroke, inspector drag, group reorder or accepted repair is one transaction. Temporary selection/view changes are local UI history unless saved explicitly.

Persist accepted transactions and required immutable assets before showing “Saved.” Propose autosave acknowledgement within 2 s after an idle edit and explicit Save within 1 s for metadata-only changes on benchmark hardware. Larger asset writes show their own progress and are not labelled durable early. A crash may discard an in-progress gesture, but must retain every transaction acknowledged as saved.

Undo restores semantic state, not edited source bytes. Redo reuses saved parameters/assets. Version history can create named snapshots, open comparison views, duplicate a branch and restore an old state as a new revision without deleting later history. Migrations operate on copies/backups, validate asset references and hashes, and never overwrite an unsupported newer project.

On open, verify manifest/schema, journal boundary and asset availability. Missing media produces a relink workflow; a filename match is insufficient when hashes differ. Retain original source hashes after relinking to a different copy and require an explicit new source identity if contents changed. Export pins a revision and reports input/output metadata plus processing versions.

## Render states and fault handling

A saved operation may be pending render, ready, failed, frozen or unsupported. Saving a pending operation preserves intent; it does not claim its audible result exists. A shared export cannot depend on a repair candidate present only in one user's cache. Failed rendering leaves the last accepted revision intact.

Asset ingestion and exports use temporary files, checksums, finalization and atomic rename where supported; test full-disk, cancellation, permission and device-removal behavior. Recovery uses consistent snapshots and journal replay with idempotent command IDs. Garbage collection must trace every retained revision, branch, snapshot and in-flight export before removing assets; trash with a grace period is preferable to immediate deletion.

## Collaboration model

Figma's historical multiplayer account motivates small document updates, but an audio graph has ordering and reproducibility constraints beyond generic object properties. Yjs offers shared types and scoped undo facilities; convergence of a CRDT alone does not guarantee a valid DSP graph. [Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [Yjs](https://docs.yjs.dev/), [UndoManager](https://docs.yjs.dev/api/undo-manager)

**Recommended first collaboration model:** a server-authoritative, ordered semantic transaction log for audio operations, with locally optimistic edits and explicit offline branches. Evaluate Yjs/Yrs for comments, annotations or document metadata where merge semantics are well defined; do not add a second competing authority over DSP order. Adopt a broader CRDT only if schema-level conflict simulations demonstrate understandable results.

| Concurrent situation | Required behavior |
| --- | --- |
| Users add separate repairs | Keep both operations; deterministic server order and stable IDs |
| Users change different controls | Merge nonoverlapping properties after validating combined parameters |
| Users change same control | Detect stale property precondition; retain alternate proposal with author/value, not silent loss |
| Users reorder same layer/group | Serialize against list revision; stale reorder becomes a reviewable conflict |
| Delete versus edit | Retain tombstone and edited proposal; require explicit restore/copy resolution |
| Overlapping repairs | Preserve both ordered operations; downstream rerender; show affected overlap |
| Undo after another user's edit | Compensate only own command where preconditions hold; otherwise propose a branch |
| Offline edits | Save local branch with common ancestor; preview merge before shared-head publication |
| Duplicate network delivery | Deduplicate command ID; exactly one accepted transaction |
| Missing accepted repair asset | Do not advance playable shared revision; show pending dependency |
| Unsupported processor/model | Use authorized frozen result if supplied; block equivalent rerender claims otherwise |

Validate commands server-side for permissions, schema, range, channel/rate limits, dependency existence, graph acyclicity, processor allowlist, bounded stroke size and idempotency. The server assigns monotonically ordered revision identifiers per project. Hashes identify content; sequence IDs identify acceptance order. A reconnect uses snapshot plus durable suffix and confirms acknowledged command IDs before retrying.

## Collaboration services and scaling

Begin with a modular service, not a fleet of microservices: authenticated WebSocket transaction/presence endpoint, relational metadata/revision store, scoped object storage and resumable asset transfer. Add a separate job worker only for explicitly requested cloud rendering/inference. Local audio playback never waits on a presence message or network round trip.

Use signed, short-lived asset access scoped to project and role. Upload chunks with integrity checks, resumable transfer and explicit completion manifests. Avoid cross-project deduplication that exposes another client's asset existence. Local media is uploaded only when the owner chooses to share that project or requests a cloud job; no implicit upload on import. Reviewers may receive a lower-bandwidth proxy with clear “proxy audio” indication. Final export requires the full authorized source and accepted derived assets.

Presence includes ephemeral cursor, selected source, visible range and optional playhead; it is throttled (~15–20 Hz), non-durable and dropped under load. Comments and edits are durable. Following changes viewport only unless the recipient explicitly enables a shared review transport. Approximate synchronized review playback uses clocks and measured drift; sample-synchronous remote performance/jamming is a separate problem and not promised.

Partition active projects by project ID; snapshot/compact logs with safe recovery watermarks; keep server-side render jobs bounded by CPU/memory/project quotas. Measure project operation count, asset bytes, join time, transaction acknowledgement, fan-out, queue lag and snapshot restore. Initial qualification target is ten concurrent editors per project, not unlimited scale.

## Roles, privacy and operational requirements

Roles: owner, editor, reviewer/commenter and viewer. Only authorized roles mutate audio graph, export protected media or invite others. Apply permissions to every API and media request; hiding UI controls is insufficient. Revocation prevents future server/media access, but cannot retract files already downloaded; communicate that practical limit in sharing controls.

Use transport encryption, encrypted managed storage and OS-protected local credentials. Project content never becomes executable shell, file paths, HTML or plugin code. Sanitize comments/imported metadata; validate archive extraction paths and expansion sizes. Untrusted decoders/plugins/model runtimes get restricted file access and resource budgets where feasible.

Plan backups with a proposed durable-edit recovery point ≤5 minutes and service recovery target ≤4 hours; perform restore drills before offering shared work commercially. Document deletion, retained backup windows, account export and cloud region policy before collaboration launch. Telemetry is opt-in and contains timing/error metadata rather than recorded audio or filenames by default.

## AI stage lifecycle

P6 introduces optional candidate generation only after manual editing/restoration is dependable. Research local-first inference for sensitive sessions and optional cloud execution for heavier models. RNNoise is a published hybrid DSP/neural speech-enhancement baseline, not a universal music-restoration engine. [RNNoise paper](https://arxiv.org/abs/1709.08243), [implementation](https://github.com/xiph/rnnoise)

Every job pins source/revision, mask, model/version/hash, runtime, seed when supported, parameters and channel/rate conversion. Run off the audio callback with cancellation and quotas. Preserve exact accepted output as an immutable derived asset even if inference is nondeterministic. Preview is loudness/latency aligned and offers residual, comparison and reject. Acceptance creates a new reversible layer; a model update cannot revise accepted sound.

Model evaluation covers speech intelligibility/identity, musical timbre, stereo image, transients, hallucinated/replaced content, and behavior on material outside training domains. Disclose reconstruction versus suppression. Dataset permissions, weight redistribution, inference terms and attribution are separate checks; a permissively licensed inference library does not establish rights to all model weights or training material. No customer recordings are used for training without explicit opt-in.
