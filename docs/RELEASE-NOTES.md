Tonalia 0.2.0 is the first downloadable development release from Fatty Recording Co.

Open local mono/stereo WAV/RF64, inspect calibrated spectra and waveforms, draw rectangle/lasso/brush selections, apply reversible spectral gain layers, compare Original/Result/Removed, save editable projects and export new float WAV files. Source audio is preserved. All editing and analysis run locally and work without an internet connection after installation.

### Download the correct installer

| Computer | Direct download |
| --- | --- |
| Windows 11 x64 (Intel/AMD) | [Windows setup.exe](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.2.0/Tonalia_0.2.0_windows_x64_setup.exe) |
| Mac Apple Silicon, macOS 13+ | [Apple Silicon DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.2.0/Tonalia_0.2.0_macos_apple_silicon.dmg) |
| Mac Intel, macOS 13+ | [Intel DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.2.0/Tonalia_0.2.0_macos_intel.dmg) |
| Linux x86-64, Ubuntu 22.04+/compatible Debian | [Debian package](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.2.0/Tonalia_0.2.0_linux_amd64.deb) |
| Other compatible Linux x86-64 desktops | [AppImage](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.2.0/Tonalia_0.2.0_linux_x86_64.AppImage) |

[Installation and offline-use instructions](https://github.com/fattyrecordingco/Tonalia/blob/main/docs/INSTALL.md) · [SHA-256 checksums](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.2.0/SHA256SUMS.txt)

Windows: run setup; the WebView2 offline installer is included. Mac: open the correct DMG and drag Tonalia into Applications. Linux: install the `.deb` through the package manager, or make the AppImage executable. Linux system prerequisites may need to be installed first.

**Signing:** this is an unsigned Windows / ad-hoc-signed, unnotarized Mac development release. OS confirmation prompts are expected. See the installation guide for platform-specific instructions; managed devices may prohibit these builds.

**New in 0.2:** keyboard guide and expanded shortcuts; mouse-wheel and trackpad pinch zoom, pointer-anchored frequency zoom and horizontal pan; initial spectral gating, harmonic hum attenuation, short-click interpolation, included offline neural speech denoising (48 kHz); local recovery history; optional experimental LAN co-editing with source identity checks and rejected-conflict recovery. New schema 2 projects preserve restoration layers; schema 1 projects remain readable.

**Verification:** the release workflow runs numerical, native LAN-protocol and browser tests before packaging. Every packaged app is installed and runs analysis, gain, gate and the included neural model; per-platform reports are attached. Mac/Linux package diagnostics apply outbound network restrictions. The public Windows installer was also installed on the owner machine, with native Open/Export/Save dialogs, CPAL playback, measured source-preserving editing, gate/neural exports and two native co-editing processes checked with outbound WebView internet blocked. Public Debian and FUSE AppImage downloads passed on Ubuntu 24.04/WSL2 with no internet interface. Owner-machine reports are attached. Physical audio latency, cross-machine LAN, hardware trackpads and the full professional roadmap are not qualified by these checks.

**Scope and limits:** this is development software, not verified Audition parity or a feature-complete professional editor. Gate/hum processing has fixed FFT resolution, interpolation targets short clicks, and the speech model can alter desired material. LAN sessions use unencrypted HTTP on trusted private networks, with serialized revisions and no shared undo. Local recovery depends on app storage. [Algorithm details and remaining work](https://github.com/fattyrecordingco/Tonalia/blob/main/docs/implementation/RELEASE-0.2.md). Keep original WAVs and explicit project backups.
