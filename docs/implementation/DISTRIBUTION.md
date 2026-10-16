# Current distribution

For **Tonalia 0.4.2**, use the [release and verification record](RELEASE-0.4.2.md), [current installer metadata](build-artifacts.json) and [download instructions](../INSTALL.md). The records below preserve the earlier 0.1 and 0.2 qualification separately.

---

# Distribution and offline verification — 0.1.0

**Published 15 October 2026.** [Official release](https://github.com/fattyrecordingco/Tonalia/releases/tag/v0.1.0) · [Download/install guide](../INSTALL.md) · [Successful native build workflow](https://github.com/fattyrecordingco/Tonalia/actions/runs/38731999630).

The release contains Windows x64 NSIS setup, separate Apple Silicon/Intel Mac DMGs, Linux amd64 Debian package and x86-64 AppImage. [Version 0.1 release files and checksums](https://github.com/fattyrecordingco/Tonalia/releases/tag/v0.1.0) identify those historical binaries. This is a development prerelease. Windows is unsigned; Mac packages are ad-hoc signed and not notarized. No binaries were substituted after their release checks.

## Native build and installed-package checks

| Package | Build/install environment | Verification |
| --- | --- | --- |
| Windows x64 setup | GitHub native Windows runner | Built setup with embedded WebView2 offline installer; installed through NSIS; installed frontend/worker/WASM analysis and measured gain check passed. [Report](release-verification-windows.json) |
| Mac Apple Silicon DMG | GitHub macOS 14 ARM runner | Mounted the DMG, accepted the licence, copied into Applications, launched installed app with outbound IP connections denied; frontend/worker/WASM and measured gain check passed. [Report](release-verification-macos-arm64.json) |
| Mac Intel DMG | GitHub macOS 15 Intel runner | Same installed-app/network-restricted checks on Intel. [Report](release-verification-macos-x64.json) |
| Linux Debian package | GitHub Ubuntu 22.04 x64 runner | Installed the `.deb`, launched `/usr/bin/tonalia-desktop` under Xvfb in a network namespace with no internet interface; frontend/worker/WASM and measured gain check passed. [Report](release-verification-linux.json) |
| Linux AppImage | GitHub Ubuntu 22.04 x64 runner | Started the actual AppImage in extraction mode in the same network isolation; frontend/worker/WASM and measured gain check passed. See `appImage` in the Linux report. |

All four platform jobs also ran the 17 core numerical tests. The Windows release job ran the nine browser integration tests. The workflow withheld publication until all jobs passed. Per-platform installed-package reports and SHA-256 checksums are attached to the release.

The opt-in `--installation-check <new-report-path.json>` mode verifies that the React workspace mounts, the bundled worker and WASM initialize, a real stereo WAV can be decoded/analyzed, and a left-channel −6 dB layer is applied while the right channel remains exact. It does not play device audio. Normal startup performs no diagnostic render or report write. A caller cannot choose an arbitrary report path through IPC: the path must be supplied at process launch.

The first Mac installation attempt stopped at the DMG licence prompt. The harness was corrected to supply acceptance, and both native Mac checks then passed. Earlier failed workflow runs remain visible in Actions; the linked successful run is the release evidence. No release installers had been published during that correction.

## Public downloads and installation on the owner machine

[Public download checks](release-downloads.json) record HTTP 200 for all five direct installer links without credentials. Windows setup, Linux `.deb` and Linux AppImage were downloaded from the published release into the user's Downloads folder, and their SHA-256 hashes matched the published checksums. Mac DMGs were installed/tested on native CI runners; no local Mac hardware was available.

**Windows:** the published setup program was opened through its regular visible installer, completed successfully and installed `%LOCALAPPDATA%\Tonalia\tonalia-desktop.exe`. The app registered as **Tonalia 0.1.0, Fatty Recording Co** in Installed Apps and created the Start menu shortcut. [Installer record](windows-installer-wizard.json).

The installed executable was then tested with a fresh temporary WebView profile. Internet-facing HTTP(S) was directed to an unreachable per-process proxy, external DNS was denied, and browser routing also rejected external origins; local Tauri IPC remained available. No external requests occurred. The test used the **actual native Open WAV, Export WAV and Save Project dialogs**. It played a short quiet native preview, saved a project, exported a 48 kHz stereo float64 WAV and verified source/overwrite protection. [Installed Windows report](windows-installed-offline.json) · [Actual installed workspace](windows-installed-offline.png).

Measured attenuation was **−5.9999996705 dB** for the intended −6 dB left-channel edit. The untouched right channel and samples outside processing support had maximum absolute error **0**. The original WAV bytes remained unchanged. The native playback clock advanced without reported playback errors. No Vite development/preview server was listening on ports 1420/1421 during the installed-app test.

**Linux on the same machine:** the published Debian package was installed normally with `apt`, which identified the package as `tonalia` version `0.1.0`. The installed executable and published AppImage both ran under Ubuntu 24.04 / WSL2 / WSLg in a new network namespace with no internet interface. Both passed the frontend, WASM, analysis and measured processing checks. The AppImage ran through its normal FUSE launch in this local check. [Debian report](linux-deb-installed-offline.json) · [AppImage report](linux-appimage-installed-offline.json).

The Linux verification processes used X11 through WSLg and disabled the DMABUF renderer for that process to accommodate the virtual display. This setting was not made global. Those tests do not qualify physical Linux audio devices or all graphics configurations.

## Offline behavior and limits

All application assets, fonts, WASM and native DSP are packaged. Local editing, analysis, monitoring, project saving and WAV export need no account, activation, server or internet service. Source audio that exists only in a cloud provider must be downloaded before offline editing. The Windows package includes the WebView2 offline prerequisite installer; Mac uses its OS WebKit runtime. Missing Linux system dependencies must be supplied through a package manager or local mirror before a fully offline install.

The owner machine's entire internet connection was not disabled. Windows testing blocked internet for the test WebView while retaining local IPC; Linux used kernel network namespaces. Mac automated checks applied a sandbox policy denying outbound IP connections. OS runtime update services are separate from Tonalia's editing functionality.

These are installation, startup, numerical and targeted workflow checks. They do not establish Audition parity, full OS-version compatibility, professional device latency, physical loopback quality, extended sessions, Gatekeeper/SmartScreen policy compatibility, or clean-machine installation with an absent WebView runtime. Production signing/notarization and broader device/OS qualification remain release work.

## 0.2.0 release update

[0.2.0](https://github.com/fattyrecordingco/Tonalia/releases/tag/v0.2.0) is published from commit `963f92fd6d1ada2d0a690addd483907e34d2600d`. [All native package/install jobs passed](https://github.com/fattyrecordingco/Tonalia/actions/runs/38756525727), as did [the application checks](https://github.com/fattyrecordingco/Tonalia/actions/runs/38756519220). Both Mac architectures, Windows x64 and Linux Debian/AppImage execute the bundled neural speech model and gate in installed-package diagnostics. The versioned `0.2-verification-*.json` files are copies of the public release reports. Current artifact metadata is in `build-artifacts.json`; the earlier sections above describe 0.1 evidence.

The additional owner-machine Windows installation uses a versioned folder because an older Tonalia session was open with unsaved edits. The agent does not close or replace that older application process or its audio source. The public installer is run through its visible wizard with update mode and a distinct destination; Start-menu registration points at 0.2. Installed-app checks use separate temporary WebView profiles and generated audio, so they do not alter the user's open project or app profile. The normal upgrade instructions recommend saving the current project and closing the previous app first.

Owner acceptance completed: [public download checks](release-0.2-downloads.json), [visible Windows installer](windows-0.2-installer-wizard.json), [installed Windows offline native workflow](windows-0.2-installed-offline.json), [two installed Windows peers](windows-0.2-two-peers.json), [Debian offline](linux-deb-0.2-installed-offline.json), [normal FUSE AppImage offline](linux-appimage-0.2-installed-offline.json). Start-menu and desktop shortcuts were pointed at the versioned 0.2 installation. The earlier open session was not closed by the agent.

The Windows native-dialog test initially failed because automation did not consistently update the modern dialog's cached filename. The harness now finds only its own visible native dialog, edits the actual File name control through native character input, clicks its real Open/Save button, and checks that the dialog closes. The complete installed workflow then passed, reading and verifying the exact expected output/project files. No application binary or published tag was changed for this harness correction.
