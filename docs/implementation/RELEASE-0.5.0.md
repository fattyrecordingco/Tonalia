# Tonalia 0.5.0

Multiple brush gestures now accumulate in a pending selection. Time, rectangle and lasso tools add to that selection; the eraser (E) subtracts with independent opacity and hardness settings. Create gain layer commits all geometry as one reversible layer. The original WAV is preserved. Erasing a selected existing layer requires Update layer to commit.

Selections use a flat, ordered list of additions and subtractions. Additions take the maximum coverage and erasers multiply existing coverage by one minus their strength. Separate strokes never share connecting segments. Each operation keeps its physical sample/Hz geometry, channel scope and brush or feather settings. FFT frame masks retain the optimized brush calculation, cull gestures outside their time support and share linked-channel calculations; scratch memory is allocated once per rendered block. UI mask geometry is cached during playback.

Project schema 3 records these operations and is intentionally rejected by older applications. Schema 1/2 imports and legacy brush behavior remain supported. Selections are limited to 128 gestures and 32,768 geometry points; nested operation lists are rejected. Combined numerical bounds summarize the union, while the eraser refines individual regions. Undo selection stroke and Clear operate on the pending selection.

## Validation

**29 core tests and 5 desktop tests passed locally.** Core tests cover ordered union/subtraction/repainting, disconnected strokes, soft weights, channel scopes, serialization, forbidden nesting and geometry limits. Render tests check erased-hole and untouched-channel preservation, attenuation in separate regions and chunk invariance. **18 browser editor tests and 26 website/Pages-path checks passed locally.** Browser integration exercises a rectangle, two brush strokes, a lasso and eraser in one pending selection, confirms zero layers before Create gain layer and exactly one afterward, and compares real WASM Removed exports before and after project reload.

The installed-package diagnostic also checks a mixed rectangle/brush-eraser mask using the packaged WASM. All release platforms must pass installation, startup and DSP diagnostics before assets can be published. Existing source-separation models and algorithms are unchanged; desktop AI setup and limits are documented in the preceding release and tools/audio-ai/README.md.

Public asset sizes, hashes, source commit and release workflow are recorded in build-artifacts.json after publication. Per-platform verification reports accompany the release. Windows packages remain unsigned and Mac packages are not notarized.

## Published packages

All four platform package jobs passed, and all five installers are publicly available. Intel Mac's first packaging attempt failed when hdiutil could not detach a temporary volume (Resource busy); the same tagged source was rerun on a fresh runner and passed packaging and installed-app verification. The successful workflow is recorded in build-artifacts.json. No tag was moved and no package check was bypassed.

Windows, Apple Silicon, Intel Mac and Debian/AppImage reports are committed as verification-0.5.0-*.json and attached to the release. All reports confirm frontend startup, worker/WASM loading and the new composite-selection/brush-eraser diagnostic. Each public installer returned HTTP 200 with the expected length; GitHub's stored asset digest matches its published SHA-256 checksum.

The local packaged Windows engine also passed dense playback with seven 512-point composite layers, channel-specific erasers and rectangles, concurrent spectrogram analysis, and Result/Removed monitoring. The original source remained unchanged. See checks-0.5.0.json for these development checks and their scope.
