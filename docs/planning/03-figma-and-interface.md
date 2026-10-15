# Figma research and Tonalia interface specification

**Status: researched interaction principles followed by original Tonalia proposals. No UI has been built.**

## What to learn from Figma

| Figma evidence | Relevant behavior | Tonalia adaptation | Audio-specific constraint |
| --- | --- | --- | --- |
| [Explore files](https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files) | Canvas objects, pages, toolbar and sidebars organize work | One spectral canvas per focused source; project navigation for sources and revisions | Time is bounded by media; frequency is bounded by Nyquist |
| [Layer selection](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects) | Canvas/panel selection, nesting, multiple selection, deep selection and locked objects | Select masks/operations on canvas or in layer tree; inspect overlapping operations | Selecting a layer must not immediately change playback or modify sound |
| [Right sidebar](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar) | Selection drives contextual properties | Numeric time/frequency bounds, processing settings, channel scope and provenance follow selection | Unknown/mixed values remain explicit; inspector gestures form transactions |
| [Zoom and view](https://help.figma.com/hc/en-us/articles/360041065034-Adjust-your-zoom-and-view-options) | Fit/selection zoom, gestures, local view preferences | Pointer-anchored navigation, saved views and independent axes | Spectral detail has finite analysis resolution; zoom cannot create information |
| [Version history](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history) | Browse/restore historical versions without discarding current history | Named audio revisions, visual diff and revision-pinned comparison | Rendered sound and source dependencies must exist for each revision |
| [Spotlight](https://help.figma.com/hc/en-us/articles/360040322673-Present-to-collaborators-using-spotlight) | Follow a collaborator's canvas view | Optional follow viewport and review position | Remote users never seize local hardware or unexpectedly start loud playback |
| [Multiplayer engineering](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) | Property-level updates, server ordering, reconnect handling | Semantic document transactions rather than transferring rendered pixels | DSP order and concurrent parameter edits can be musically consequential |

The engineering article is a historical implementation account, not a specification of Figma's current infrastructure. Tonalia will independently test its concurrency policy. The intended benefit is direct work on persistent, inspectable audio objects, with numerical precision available at every step.

## Workspace concept

```text
┌ Tonalia · Fatty Recording Co | Project / revision | Save state | Share ┐
│ Select  Time  Rectangle  Lasso  Brush  Repair | Context options         │
├ Assets / Layers ┬───────────────────────────────────┬ Inspector       ┤
│ Sources        │ Overview waveform + viewport      │ Selection       │
│ Focused source │ Time ruler / markers / loop       │ Time · Hz       │
│  Original      │ Waveform lanes                    │ Channels        │
│  Hum control   │                                   │ Processor       │
│  Click repairs │ Spectral canvas + mask overlays   │ Strength        │
│  Hiss profile  │                                   │ Feather / scope │
│ Saved regions  │ Frequency ruler + dB legend        │ Provenance      │
├────────────────┴───────────────────────────────────┴─────────────────┤
│ Analysis drawer: Spectrum | Stereo | Statistics | Loudness | Events  │
│ Stop Play Loop | position | Original/Result/Selection/Residual | Level │
└ Engine rate · device · latency · render state · cache/jobs ──────────┘
```

This diagram specifies information hierarchy, not artwork. Initial implementation should expose fewer tools as they become functional. Unavailable processors must never appear usable with fabricated results.

At a 1440×900 reference window, propose a 48 px project bar, 44 px tool strip, 240 px collapsible left rail, 288 px inspector, 56 px transport/status region, and a resizable analysis drawer initially closed. Permit 160–360 px left and 240–420 px right panels. At 1280×720 collapse optional navigation and drawer; preserve transport, rulers, engine status, and the focused canvas. At larger sizes show multiple analysis panels without shrinking the canvas below usefulness.

## Visual language

Use a neutral dark workspace: provisional canvas `#111419`, panels `#1A1F27`, separators `#303946`, text `#E8EDF4`, muted text `#A9B4C4`, action accent `#58CFC0`, and warning `#F3BE68`. These are candidates; measure contrast before shipping. Reserve strong colors for spectral energy, active selections, processing states, and metering.

Use a perceptually ordered spectral palette with a persistent numeric dB legend, plus a color-vision-friendly alternative. Mask fill uses hatching/edges so it remains distinguishable from spectral energy. Remote cursors use names and patterns, not color alone. Clip warnings require both a symbol and a value.

Choose a system sans-serif UI family, tabular numerals for meters/time/Hz, 13–14 px primary controls, and at least 12 px secondary labels. User scaling and high-DPI rendering are mandatory. Tooltips explain units and sound consequences rather than internal framework terms.

## Canvas geometry and precision

Map horizontal coordinates to integer source sample indices through an explicit view transform. Store frequency in Hz, with log mapping only in the display transform. At 48 kHz, show DC separately in logarithmic mode and cap the upper edge at 24 kHz. The inspector always reports actual bounds, selected channels, and the analysis resolution.

A canvas object may be a saved region, an operation mask, a marker, or a comment. It is distinct from the underlying spectral raster. The playhead and loop are transport objects, not layers. Pointer hit-testing prioritizes active handles, then selected overlays, then selectable objects, then selection creation. A context menu lists overlapping operations.

Changing display FFT size triggers reanalysis and never reinterprets existing audio operations. Processor analysis configuration is versioned separately. Show the processor's actual effective time/frequency support when requested, because a narrow drawn edge cannot eliminate STFT leakage.

## Tool contracts

| Tool | Gesture and controls | Completion and undo |
| --- | --- | --- |
| Navigate/select | Click object; drag handles; temporary hand with held key/middle button | One move/resize gesture is one reversible transaction |
| Time | Drag any time span; numeric start/end/sample count | Selection remains temporary until an operation is created |
| Rectangle | Time-frequency drag; Shift adds, Alt/Option subtracts | Boolean mask operation; bounds can be edited numerically |
| Lasso | Freehand path closes on release; tolerance specified in physical units at commit | Preserve original path plus deterministic mask representation |
| Brush | Size, hardness, opacity, spacing; add/erase; optional pressure | Preview immediately; stroke commits once; pressure absent means 1 |
| Repair | Paint region → render candidate → compare → accept/cancel | Never modifies original; acceptance creates a repair layer |
| Intelligent selection | Seed ridge/harmonic/transient; tolerance and extent; confidence view | User accepts/refines proposal; no automatic processing |

For the brush, show pixel cursor size while drawing but freeze the mapped time/Hz footprint in the committed stroke. On a logarithmic ruler the footprint may be asymmetric in Hz. A new zoom affects new strokes only. Advanced mode allows time radius and Hz or octave width to be set numerically. Pressure controls opacity by default, not processing gain directly.

Moving a **mask** retargets the same processor to a different source region. Moving **spectral content** is a separate later command requiring resynthesis, source/destination rules and phase handling. A frequency-axis drag must not pretend that a spectrogram is an image that can be moved without DSP consequences.

## Preview and transport states

The transport exposes Stop, Play/Pause, loop, position, monitor mode and monitor gain. A/B comparison aligns latency and optionally matches listening level; exported gain changes only through a saved operation. Residual is explicitly input minus result at a named graph boundary. Selection audition uses the selected mask; it does not permanently isolate a source.

Every preview has states: unchanged → parameters edited → rendering → ready → playing, with failed/cancelled alternatives. Rendering shows progress and the exact pending revision. During parameter edits, keep the previously pinned playback revision audible only with a visible “Playing previous revision” indicator; switch to the new aligned result after it is complete. Offer pause-until-ready as a preference. Do not intermingle half-old and half-new tiles or samples.

Live-capable processors respond with smoothing; offline processors render a bounded loop plus required context. Quality modes are named Draft and Final only when they actually differ. Default final export uses the final algorithm; auditioning that exact result is available before delivery.

## Layer and inspector behavior

The layer tree lists input source at the bottom and processing order bottom-to-top, with an explicit signal-flow indicator. Dragging to reorder previews the insertion position and may require rerendering downstream operations. A closed group behaves as an ordered subchain. Initial blend behavior is only processor wet/dry; arbitrary image blend modes are excluded.

Each layer shows name, processor type, channel scope, enabled state, edit lock, overlay visibility and render status. Lock is an editing aid locally, not an authorization mechanism. Group bypass and isolation preserve a stable signal path. “Solo layer” means audition the chain through that layer, with later layers bypassed; “Hear change” means residual across that layer. Neither implies an isolated instrument stem.

Inspector tabs: **Edit**, **Analyze**, **Review**. With no object selected show focused-source properties and display controls. With one operation selected show its mask, processor, measured latency, settings, context, input revision and provenance. With mixed selections expose only shared controls and mark differing values “Mixed.” Numeric values support typed units and meaningful steps; invalid values remain uncommitted with an explanation.

## Proposed shortcut map

These are Tonalia defaults, not a promise to clone Figma or Audition shortcuts. Provide a searchable, remappable command palette and platform-conflict checks.

| Command | Proposed default | Context rule |
| --- | --- | --- |
| Play/pause | Space | Outside text entry; tap toggles transport |
| Temporary pan | Hold Space then drag | Pointer gesture wins over pending tap; key-up restores tool |
| Select / Time | V / T | Canvas focus only |
| Rectangle / Lasso / Brush / Repair | M / L / B / J | Only functional installed tools appear |
| Brush size | `[` / `]` | Brush/repair tools |
| Add / subtract mask | Shift / Alt or Option | While drawing; documented in toolbar |
| Fit project / fit selection | Shift+1 / Shift+2 | Current focused source/view |
| Horizontal zoom | Ctrl or Cmd + wheel | Anchor at pointer; pinch configurable |
| Frequency zoom | Alt/Option + wheel over frequency ruler | Does not change time bounds |
| Undo / redo | Ctrl/Cmd+Z / platform-standard redo | Focus-aware; one gesture per undo |
| Command palette | Ctrl/Cmd+K | Search actions, tools, layers and settings |
| Escape | Esc | Cancel active gesture/job proposal before clearing selection |
| Save / export | Ctrl/Cmd+S / Ctrl/Cmd+Shift+E | Save project versus render audio clearly distinguished |

Do not capture standard text-navigation shortcuts while editing values. Provide non-character alternatives for all single-letter commands. Verify the Space tap/drag arbitration with mouse, trackpad and assistive input before adoption.

## Accessibility and error design

All tools have keyboard routes and numeric alternatives. Canvas objects have a synchronized accessible list, names, bounds, roles and operation summaries; the canvas alone cannot provide screen-reader access. Tab follows controls rather than hijacking Figma's sibling-selection behavior. Expose focus, high contrast, reduced motion, keyboard pan/zoom, tool labels, and independent UI scale.

Missing media opens a relink panel with expected hash and metadata. A failed repair remains a retryable proposal. GPU loss switches visualization backend while native audio continues. Export clipping prompts choices with predicted sample/true-peak values. Unsupported processor versions display the last frozen result if available and identify its provenance.

## Measurable interaction acceptance

On the benchmark hardware defined in [08](08-testing-and-verification.md): warm pan/zoom frame time p95 ≤16.7 ms at 1440×900/60 Hz; stroke-to-overlay latency p95 ≤30 ms; numeric edits acknowledged within 50 ms; no React rerender is required for each audio sample, spectral pixel, or animation frame. A ten-minute orientation should enable ≥80% of the eight-person editor cohort to complete the core workflow without help. These are proposed gates and require user testing, including at least two participants using accessibility adaptations.
