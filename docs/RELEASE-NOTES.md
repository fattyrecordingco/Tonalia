Tonalia 0.5.0 lets you build one selection with multiple brush strokes and different selection tools, then refine it with an eraser before creating a gain layer.

### Combined selections and eraser

- Brush strokes accumulate across gestures. Time, rectangle and lasso tools add to the same pending selection, without lines connecting separate strokes.
- Selection eraser (**E**) subtracts with adjustable diameter, hardness and opacity. Painting back over an erased region adds it again.
- **Undo selection stroke** removes the most recent pending gesture; **Clear** starts again. **Create gain layer** commits all the shapes as one reversible layer. Erasing a selected existing layer requires **Update layer** to commit.
- Each gesture retains its channel, feather and brush settings. Linked gestures share optimized mask calculations; channel-specific gestures are rendered independently. Preview geometry is cached during playback.
- Project schema 3 stores ordered add/subtract geometry. Schema 1 and 2 projects still open, including legacy brush behavior; new saves require Tonalia 0.5.0 or later.
- Selection limits are 128 gestures and 32,768 points per layer. Combined bounds summarize the selection; clear it to enter a new exact rectangle.

The existing local sound separation, noise reduction, precision navigation and brush playback improvements are retained.

### Brush playback fix

Dense strokes previously evaluated every stroke segment for every FFT bin and channel, which could starve the audio render queue. The engine now visits only the bins a stroke can affect, shares the mask across channels and skips untouched frames. Stroke geometry and older saved-brush behavior are preserved. Desktop playback has more preparation headroom; desktop and browser playback recover brief queue gaps without advancing past unplayed samples. Device errors and sustained stalls still stop with an error.

### Editing features

- Continuous brushes with adjustable size, opacity and hardness, plus a live footprint preview.
- Independent frequency zoom, vertical pan buttons, Hz-ruler scrolling, a vertical range slider and exact frequency bounds. Display FFT sizes extend to 16,384 samples.
- Captured noise profiles and reversible per-channel noise reduction in Restore.
- WAV drag and drop in the desktop and browser editor.
- Export **Result**, **Removed**, or **Original** at the source rate/channel count. Removed matches the original-minus-result monitor signal; export it separately from the cleaned recording.

### Separate sounds — desktop

Open a WAV and choose **Separate sounds → Auto separate → Analyse and separate**. Optional local PANNs, AudioSep and HT-Demucs packs detect likely sources and produce separate WAV estimates with joint spectral cleanup and an unassigned residual. **Find sounds** shows actual detector results and supports direct extraction. Music can be split into vocals, drums, bass, guitar, piano and other instruments. Manual descriptions and spectral transient extraction are also available. Preview, edit or export the generated tracks.

Python 3.11+ and a one-time download are required for these optional packs (about 1.1 GiB of model assets, plus dependencies). They run on your computer after setup; recordings are not uploaded. Detection can miss small or unfamiliar sounds; a transient is not guaranteed to be identified as the object that made it. Separation is an estimate and can leave bleed. Keep and inspect the residual. AI separation requires the desktop app; the browser includes the spectral editing, noise reduction and export improvements.

### Downloads

| Computer | Installer |
| --- | --- |
| Windows 11 x64 | [Windows setup.exe](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.5.0/Tonalia_0.5.0_windows_x64_setup.exe) |
| Mac Apple Silicon, macOS 13+ | [Apple Silicon DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.5.0/Tonalia_0.5.0_macos_apple_silicon.dmg) |
| Mac Intel, macOS 13+ | [Intel DMG](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.5.0/Tonalia_0.5.0_macos_intel.dmg) |
| Linux x86-64, Ubuntu 22.04+/compatible Debian | [Debian package](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.5.0/Tonalia_0.5.0_linux_amd64.deb) |
| Compatible Linux x86-64 desktop | [AppImage](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.5.0/Tonalia_0.5.0_linux_x86_64.AppImage) |

[Website and browser editor](https://fattyrecordingco.github.io/Tonalia/) · [Illustrated guide](https://fattyrecordingco.github.io/Tonalia/guide/) · [Installation instructions](https://github.com/fattyrecordingco/Tonalia/blob/main/docs/INSTALL.md) · [SHA-256 checksums](https://github.com/fattyrecordingco/Tonalia/releases/download/v0.5.0/SHA256SUMS.txt)

Save your project and close Tonalia before upgrading. Run the installer to update the installed app and shortcuts. Schema 1, 2 and 3 projects remain readable after verifying the original WAV. Generated AI tracks are separate audio files; export them before clearing the AI cache.

### Verification and limits

The release workflow runs core numerical tests, desktop tests, browser integration checks and actual package installation/DSP diagnostics before publishing the assets. The startup check waits for the actual React workspace to mount, replacing a two-frame assumption that failed on WebKit. Per-platform verification reports accompany the installers. The source includes dense-brush playback tests and real-model separation contracts. See the [0.5.0 verification record](https://github.com/fattyrecordingco/Tonalia/blob/main/docs/implementation/RELEASE-0.5.0.md) for measured results and scope.

This remains a development release: Windows is unsigned and Mac packages are not notarized. It opens mono/stereo WAV/RF64 and exports float WAV; there is no multitrack timeline, MP3 import, recording, plug-in hosting or guaranteed Audition parity. Display detail is independent of the fixed 2048-point processing FFT. Existing 48 kHz neural speech denoise and experimental trusted-LAN co-editing remain available with their earlier limits.
