Tonalia 0.1.0 is the first downloadable development release from Fatty Recording Co.

Open local mono/stereo WAV/RF64, inspect calibrated spectra and waveforms, draw rectangle/lasso/brush selections, apply reversible spectral gain layers, compare Original/Result/Removed, save editable projects and export new float WAV files. Source audio is preserved. All editing and analysis run locally and work without an internet connection after installation.

### Download the correct installer

| Computer | Direct download |
| --- | --- |
| Windows 11 x64 (Intel/AMD) | [Windows setup.exe](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_windows_x64_setup.exe) |
| Mac Apple Silicon, macOS 13+ | [Apple Silicon DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_macos_apple_silicon.dmg) |
| Mac Intel, macOS 13+ | [Intel DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_macos_intel.dmg) |
| Linux x86-64, Ubuntu 22.04+/compatible Debian | [Debian package](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_linux_amd64.deb) |
| Other compatible Linux x86-64 desktops | [AppImage](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_linux_x86_64.AppImage) |

[Installation and offline-use instructions](https://github.com/fattyrecordingco/Tonalia/blob/main/docs/INSTALL.md) · [SHA-256 checksums](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/SHA256SUMS.txt)

Windows: run setup; the WebView2 offline installer is included. Mac: open the correct DMG and drag Tonalia into Applications. Linux: install the `.deb` through the package manager, or make the AppImage executable. Linux system prerequisites may need to be installed first.

**Signing:** this is an unsigned Windows / ad-hoc-signed, unnotarized Mac development release. OS confirmation prompts are expected. See the installation guide for platform-specific instructions; managed devices may prohibit these builds.

**Verification:** all native release jobs passed core numerical tests, packaging, installation/startup and bundled frontend/worker/WASM DSP checks. Per-platform JSON reports are attached. Linux and Mac installation checks applied outbound network restrictions. The public Windows installer was also downloaded, checksum-verified and installed on the owner machine, where native Open WAV/Export WAV/Save Project dialogs, CPAL playback, measured spectral editing and export passed with outbound WebView internet blocked. The published Debian package and AppImage also passed on Ubuntu 24.04/WSL2 with no internet interface. [Detailed verification record](https://github.com/fattyrecordingco/Tonalia/blob/main/docs/implementation/DISTRIBUTION.md) · [Installed Windows offline report](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/verification-windows-installed-offline.json). These checks do not qualify production audio latency or every device/OS combination.

**Scope:** spectral gain editing is implemented. Professional restoration/healing/noise reduction, collaboration, AI, crash recovery, professional metering and Audition feature parity remain outstanding. Preserve your source recordings and save project snapshots explicitly. See [current limits](https://github.com/fattyrecordingco/Tonalia/blob/main/README.md#current-limits).
