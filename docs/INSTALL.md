# Download and install Tonalia

Tonalia is developed by Fatty Recording Co. **0.1.0 is a development release** with working local spectral gain editing. Professional restoration, collaboration and AI remain future stages.

You do not need Node.js, Rust, a browser tab, a server or a Tonalia account to run an installed desktop app. The audio engine, WebAssembly, interface, icons and fonts are included. Audio stays on your machine.

## Choose your download

Download from the [official Tonalia 0.1.0 release](https://github.com/fattyrecordingco/Tonalia/releases/tag/v0.1.0). These links point directly to the versioned installers; they become available when the release workflow has completed successfully.

| Your computer | Direct download | Installation |
| --- | --- | --- |
| Windows 11, Intel or AMD 64-bit | [Windows x64 setup.exe](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_windows_x64_setup.exe) | Open the setup program; installs for your user |
| Mac with Apple M-series chip, macOS 13+ | [Mac Apple Silicon .dmg](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_macos_apple_silicon.dmg) | Open the disk image; drag Tonalia into Applications |
| Mac with Intel processor, macOS 13+ | [Mac Intel .dmg](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_macos_intel.dmg) | Open the disk image; drag Tonalia into Applications |
| Ubuntu 22.04+ or compatible Debian-based Linux, x86-64 | [Linux amd64 .deb](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_linux_amd64.deb) | Install with your package manager |
| Other compatible Linux desktop, x86-64 | [Linux x86-64 .AppImage](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/Tonalia_0.1.0_linux_x86_64.AppImage) | Make executable, then open |

Linux ARM and Windows ARM do not have native packages in this release. Debian-derived systems other than the build baseline and other AppImage distributions need testing; AppImage is not a promise of compatibility with every Linux distribution. Windows 10 is outside the qualified baseline.

To identify your Mac, open **Apple menu → About This Mac**: “Chip: Apple M…” means Apple Silicon; “Processor: Intel…” means Intel. On Windows, use **Settings → System → About → System type**. On Linux, `uname -m` should show `x86_64` for these downloads.

## Windows

1. Download the Windows setup program above and open it.
2. Follow the installer screens. The default installation is for your Windows user, without a system-wide developer setup.
3. Open **Tonalia** from the Start menu or installation shortcut.
4. Choose **Open WAV** to open a local recording, or explore the generated calibration session.

This release has no commercial code-signing certificate, so Windows may display an unknown-publisher or SmartScreen prompt. Confirm that the download is from this repository and check its hash before choosing to run it. Managed-computer policies may prohibit unsigned apps.

The setup program includes Microsoft's WebView2 offline installer. It can install that prerequisite without downloading it if it is missing. Tonalia uses the installed WebView runtime; WebView's own system updates are managed separately by Windows. Uninstall through **Settings → Apps → Installed apps → Tonalia → Uninstall**. Your original recordings and separately saved projects remain in their chosen folders.

## macOS

1. Download the DMG for your chip type and open it.
2. Drag **Tonalia** onto **Applications** in the disk-image window.
3. Eject the disk image and open **Applications → Tonalia**.

These development builds have ad-hoc signatures and are **not Apple notarized**. macOS may refuse the first launch. After attempting to open Tonalia, use **System Settings → Privacy & Security → Open Anyway** for this specific app if you trust the official download. Follow the confirmation prompt. Do not disable Gatekeeper system-wide. Organization security policies can still block an unnotarized app. See [Apple's instructions for opening an app from an unidentified developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac).

Delete Tonalia from Applications to uninstall. Keep your original WAV and saved project files wherever you normally store recordings.

## Linux

For Ubuntu/Debian-compatible systems, open a terminal in the download folder:

```sh
sudo apt install ./Tonalia_0.1.0_linux_amd64.deb
```

Then open **Tonalia** from your desktop's applications menu. The executable is `tonalia-desktop`. The package manager checks and installs system dependencies, including the GTK/WebKit runtime and audio libraries. Installing missing Linux system dependencies normally requires internet or a local package mirror; the application itself runs offline once they are present.

For AppImage:

```sh
chmod +x Tonalia_0.1.0_linux_x86_64.AppImage
./Tonalia_0.1.0_linux_x86_64.AppImage
```

If FUSE is unavailable, try the runtime's extraction mode:

```sh
./Tonalia_0.1.0_linux_x86_64.AppImage --appimage-extract-and-run
```

A compatible desktop/graphics and audio environment is still required. Remove the Debian package with `sudo apt remove tonalia-desktop`, or delete the AppImage. No local audio is uploaded.

## Offline use

After downloading and installing the appropriate package, disconnect Wi-Fi or your network connection and open Tonalia normally. Open a local WAV, select a region, create a gain layer, compare Original/Result/Removed, save a project, and export a new WAV. None of those operations requires internet. Source files stored only in a cloud service must first be downloaded or marked available offline through that service.

There is no licence activation, login, telemetry service, remote font/CDN dependency, AI download, server process, or automatic application updater. The installed application serves its packaged interface directly through Tauri. Downloading the release, developer builds and installing missing Linux system prerequisites are separate online activities.

Release verification reports distinguish automated installation/startup/DSP checks from real audio-device and owner-machine checks. They do not certify professional latency, all operating-system versions, or all audio hardware.

## Verify a download

[Download SHA256SUMS.txt](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.1.0/SHA256SUMS.txt). Compare the line for your exact file:

```powershell
# Windows PowerShell
Get-FileHash .\Tonalia_0.1.0_windows_x64_setup.exe -Algorithm SHA256
```

```sh
# macOS
shasum -a 256 Tonalia_0.1.0_macos_apple_silicon.dmg
# Linux
sha256sum Tonalia_0.1.0_linux_amd64.deb
```

Hashes detect corruption and identify a release asset; they do not replace platform code-signing/notarization.

## Editing and help

See the [README](../README.md) for tools, shortcuts, supported WAV formats and source-build commands, and [implementation status](implementation/STATUS.md) for technical limits and evidence. Report problems in [Tonalia issues](https://github.com/fattyrecordingco/Tonalia/issues), including operating system, chip type, package filename and error text. Avoid posting private recordings.
