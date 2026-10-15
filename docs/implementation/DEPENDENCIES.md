# Dependency notes

The application implements its own selection, spectral processing, file handling and project behavior. The major dependencies are React/React DOM (UI), TypeScript/Vite (build), Tauri (desktop shell and dialogs), CPAL (device I/O), rtrb (bounded audio queue), RustFFT (FFT), SHA-2 (source fingerprints), wasm-bindgen/serde-wasm-bindgen (portable bindings), serde (data model), Lucide (icons) and DM Sans (locally bundled font).

Exact dependency resolutions are recorded in `Cargo.lock` and `package-lock.json`; the Rust toolchain is pinned. No Adobe/Figma proprietary implementation, JUCE SDK, FFmpeg binary, neural model or extracted code from the other reviewed repositories is included.

The bundled DM Sans font is distributed under the SIL Open Font License. React is MIT licensed; Lucide uses the ISC licence. Rust/Tauri dependencies include MIT and/or Apache-2.0 packages. Preserve each package's original licence/notice when redistributing; the project's MIT licence does not replace those terms. Inspect the exact package versions and transitive dependencies for each distributable release.

`wasm-pack` is development tooling. The npm wrapper was updated to 0.15.0 after the older wrapper's dependency audit failed; the final npm audit must be recorded with the implementation checks. No installer or source has been published to GitHub by this task.

This file is an engineering inventory, not a completed third-party licence/compliance audit for a commercial release.
