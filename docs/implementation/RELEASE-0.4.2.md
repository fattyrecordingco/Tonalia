# Tonalia 0.4.2

This release contains the sound-separation, precision editing, noise-profile and brush/playback corrections described in [release notes](../RELEASE-NOTES.md). The measured DSP and real-model checks from the 0.4.1 candidate are retained in [checks-0.4.1.json](checks-0.4.1.json) and [the detailed engine record](RELEASE-0.4.1.md); their version labels identify the actual tested build.

## Installed-app startup verification

The 0.4.1 candidate was withheld because its Apple Silicon installed-app check reported that React had not mounted. That check only waited two animation frames before inspecting a concurrently rendered root. Version 0.4.2 observes the actual workspace mount with a bounded 15-second timeout, captures startup errors and unhandled rejections, and initializes the separate diagnostic engine after the workspace is ready. Actual frontend errors or failed analyzer, spectral gain, gate or neural checks still fail publication. Normal launches do not run these diagnostic renders.

The tagged release workflow reruns numerical, native and browser checks, builds all five installers and installs/runs each package before publishing. Exact public asset hashes, sizes, source commit and workflow are recorded in [build-artifacts.json](build-artifacts.json). Each platform's installed-package report accompanies the release. Mac builds remain unnotarized, and Windows remains unsigned.

The website and browser editor are published together after the release downloads are available. AI separation uses optional desktop packs; browser editing includes noise profiles, vertical navigation, improved brushes, WAV drop and Original/Result/Removed export. See [AI setup, model attribution and limits](../../tools/audio-ai/README.md).

## Platform package results

All four package jobs and the release publication job passed. Installed frontend, worker/WASM, gain, gate and bundled neural diagnostics passed on [Windows](verification-0.4.2-windows.json), [Apple Silicon](verification-0.4.2-macos-arm64.json), [Intel Mac](verification-0.4.2-macos-x64.json), and [Linux Debian/AppImage](verification-0.4.2-linux.json). Both Mac reports confirm that the workspace mounted with no captured frontend errors under the revised readiness check.

## Public Windows installer and restored project

The public Windows installer was downloaded, SHA-256 verified and used to upgrade the owner installation. Registry and executable versions both report 0.4.2. Installed-app checks passed with actual native Open/Save/Export dialogs and outbound WebView internet blocked: CPAL playback, gain/restoration export, exact untouched-channel preservation, original overwrite protection and 64-bit Result/Removed reconstruction. The installed build also passed real detection, direct extraction, preview/export and threshold abstention with the existing optional AI packs retained.

The current seven-layer user project was explicitly backed up before closing the previous app, restored after the installer update, and tested through the affected brush passage in Removed playback. Its original WAV hash remained unchanged. Private recordings, paths and backups are excluded from the [published owner-machine results](checks-0.4.2.json).
