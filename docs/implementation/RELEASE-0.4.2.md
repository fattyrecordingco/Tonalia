# Tonalia 0.4.2

This release contains the sound-separation, precision editing, noise-profile and brush/playback corrections described in [release notes](../RELEASE-NOTES.md). The measured DSP and real-model checks from the 0.4.1 candidate are retained in [checks-0.4.1.json](checks-0.4.1.json) and [the detailed engine record](RELEASE-0.4.1.md); their version labels identify the actual tested build.

## Installed-app startup verification

The 0.4.1 candidate was withheld because its Apple Silicon installed-app check reported that React had not mounted. That check only waited two animation frames before inspecting a concurrently rendered root. Version 0.4.2 observes the actual workspace mount with a bounded 15-second timeout, captures startup errors and unhandled rejections, and initializes the separate diagnostic engine after the workspace is ready. Actual frontend errors or failed analyzer, spectral gain, gate or neural checks still fail publication. Normal launches do not run these diagnostic renders.

The tagged release workflow reruns numerical, native and browser checks, builds all five installers and installs/runs each package before publishing. Exact public asset hashes, sizes, source commit and workflow are recorded in [build-artifacts.json](build-artifacts.json). Each platform's installed-package report accompanies the release. Mac builds remain unnotarized, and Windows remains unsigned.

The website and browser editor are published together after the release downloads are available. AI separation uses optional desktop packs; browser editing includes noise profiles, vertical navigation, improved brushes, WAV drop and Original/Result/Removed export. See [AI setup, model attribution and limits](../../tools/audio-ai/README.md).
