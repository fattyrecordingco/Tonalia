import { invoke } from '@tauri-apps/api/core';
import { AudioEngine } from './engine/client';
import { isNative, type Layer } from './types';

/** Opt-in installed-package check. Normal launches create no worker or report here. */
export async function verifyInstallation() {
  if (!isNative() || !(await invoke<boolean>('installation_check_enabled'))) return;
  const engine = new AudioEngine();
  const report: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    origin: location.origin,
    passed: false,
  };
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!document.querySelector('.app')) throw new Error('The React workspace did not mount.');
    const rate = 48000,
      frames = rate * 2;
    const buffer = new ArrayBuffer(44 + frames * 8);
    const view = new DataView(buffer);
    const text = (at: number, value: string) =>
      [...value].forEach((v, i) => view.setUint8(at + i, v.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 3, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 8, true);
    view.setUint16(32, 8, true);
    view.setUint16(34, 32, true);
    text(36, 'data');
    view.setUint32(40, frames * 8, true);
    for (let i = 0; i < frames; i++) {
      const value = Math.sin((2 * Math.PI * 937.5 * i) / rate) * 0.25;
      view.setFloat32(44 + i * 8, value, true);
      view.setFloat32(48 + i * 8, -value, true);
    }
    const info = await engine.load({
      kind: 'browser',
      file: new File([buffer], 'installation-reference.wav'),
    });
    const analysis = await engine.analyze(
      { start: 0, end: frames, low: 20, high: 24000, log: true },
      2048,
      [],
      24,
    );
    if (!analysis || !analysis.levels.some((v) => v > -15 && v < -10))
      throw new Error('The installed WASM analyzer failed calibration.');
    const layer: Layer = {
      id: 'installation-check',
      name: 'Installation check',
      enabled: true,
      gainDb: -6,
      mask: {
        shape: { kind: 'rectangle', start: 0, end: frames, low: 0, high: 24000 },
        channel: 0,
        featherTime: 0,
        featherHz: 0,
      },
    };
    const args = { position: 24000, count: 4096, deviceRate: rate, end: frames, layers: [layer] };
    const original = await engine.call<{ samples: Float32Array }>('playback', {
      ...args,
      mode: 'original',
    });
    const processed = await engine.call<{ samples: Float32Array }>('playback', {
      ...args,
      mode: 'result',
    });
    let leftError = 0,
      rightError = 0;
    for (let i = 0; i < original.samples.length; i += 2) {
      leftError = Math.max(
        leftError,
        Math.abs(processed.samples[i] - original.samples[i] * 10 ** (-6 / 20)),
      );
      rightError = Math.max(
        rightError,
        Math.abs(processed.samples[i + 1] - original.samples[i + 1]),
      );
    }
    if (leftError > 2e-8 || rightError !== 0)
      throw new Error(`Installed processing failed: ${leftError}, ${rightError}`);
    Object.assign(report, {
      passed: true,
      frontendMounted: true,
      wasmLoaded: true,
      workerAnalysis: true,
      channels: info.channels,
      sampleRate: info.sampleRate,
      renderedFrames: 4096,
      leftGainMaxError: leftError,
      untouchedRightChannelMaxError: rightError,
    });
  } catch (error) {
    report.error = String(error);
  } finally {
    engine.dispose();
    await invoke('finish_installation_check', { report });
  }
}
