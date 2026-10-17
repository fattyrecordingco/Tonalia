import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

// Exercise the real packaged audio device while the processed spectrogram is
// being analysed. Seven dense strokes exceed the reported project's complexity.
const temp = await mkdtemp(join(tmpdir(), 'tonalia-brush-playback-'));
const inputPath = join(temp, 'brush-reference.wav');
const projectPath = join(temp, 'brush-reference.tonalia.json');
const rate = 44100,
  frames = rate * 18;
const input = Buffer.alloc(44 + frames * 4);
input.write('RIFF');
input.writeUInt32LE(input.length - 8, 4);
input.write('WAVEfmt ', 8);
input.writeUInt32LE(16, 16);
input.writeUInt16LE(1, 20);
input.writeUInt16LE(2, 22);
input.writeUInt32LE(rate, 24);
input.writeUInt32LE(rate * 4, 28);
input.writeUInt16LE(4, 32);
input.writeUInt16LE(16, 34);
input.write('data', 36);
input.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  input.writeInt16LE(Math.round(1500 * Math.sin((2 * Math.PI * 937.5 * i) / rate)), 44 + i * 4);
  input.writeInt16LE(Math.round(1100 * Math.sin((2 * Math.PI * 1900 * i) / rate)), 46 + i * 4);
}
const hash = createHash('sha256').update(input).digest('hex');
const layers = Array.from({ length: 7 }, (_, layer) => ({
  id: `stress-brush-${layer}`,
  name: `Dense brush ${layer + 1}`,
  enabled: true,
  gainDb: 11.5,
  mask: {
    channel: null,
    featherTime: 220.5,
    featherHz: 21.5,
    shape: {
      kind: 'brush',
      radiusTime: 29910,
      radiusHz: 1117,
      opacity: 0.7,
      hardness: 0.5,
      points: Array.from({ length: 512 }, (_, i) => ({
        sample: 2048 + (i / 511) * (frames - 4096),
        hz: 500 + layer * 850 + 400 * Math.sin(i * 0.07),
      })),
    },
  },
}));
for (const layer of layers) {
  const brush = structuredClone(layer.mask);
  layer.mask = {
    channel: null,
    featherTime: 0,
    featherHz: 0,
    shape: {
      kind: 'composite',
      operations: [
        { mode: 'add', mask: brush },
        {
          mode: 'subtract',
          mask: {
            channel: 0,
            featherTime: 0,
            featherHz: 0,
            shape: {
              kind: 'brush',
              points: [
                { sample: rate * 4, hz: 1900 },
                { sample: rate * 5, hz: 2300 },
              ],
              radiusTime: rate / 4,
              radiusHz: 800,
              opacity: 0.8,
              hardness: 0.5,
            },
          },
        },
        {
          mode: 'add',
          mask: {
            channel: 1,
            featherTime: 220.5,
            featherHz: 21.5,
            shape: { kind: 'rectangle', start: rate * 10, end: rate * 11, low: 1400, high: 2000 },
          },
        },
      ],
    },
  };
}
await writeFile(inputPath, input);
await writeFile(
  projectPath,
  JSON.stringify({
    format: 'tonalia',
    schema: 3,
    engine: 'spectral-edit-v3',
    fftSize: 2048,
    source: {
      name: 'brush-reference.wav',
      size: input.length,
      sha256: hash,
      sampleRate: rate,
      channels: 2,
      frames,
    },
    layers,
    view: { start: 0, end: frames, low: 20, high: rate / 2, log: true },
  }),
);
const port = await new Promise((done) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const value = server.address().port;
    server.close(() => done(value));
  });
});
const executable =
  process.env.TONALIA_TEST_EXECUTABLE || resolve('target/release/tonalia-desktop.exe');
const child = spawn(executable, [inputPath], {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(temp, 'profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByText('SHA-256 verified', { exact: true }).waitFor();
  await page.getByLabel('Import project', { exact: true }).setInputFiles(projectPath);
  await page.getByRole('button', { name: 'Delete Dense brush 7', exact: true }).waitFor();
  await page.getByLabel('Monitor volume').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '-60');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const positions = {};
  for (const mode of ['Result', 'Removed']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: 'Return to start', exact: true }).click();
    // Changing display resolution forces concurrent processed-audio analysis.
    await page
      .getByLabel('Analysis FFT size', { exact: true })
      .selectOption(mode === 'Result' ? '4096' : '8192');
    await page.getByRole('button', { name: 'Play audio', exact: true }).click();
    await page.waitForFunction(
      () => {
        const parts = document.querySelector('.time-display>span')?.textContent?.split(':');
        return parts && Number(parts.at(-1)) >= 8;
      },
      undefined,
      { timeout: 25000 },
    );
    assert(await page.getByRole('button', { name: 'Pause playback', exact: true }).isVisible());
    positions[mode] = await page.locator('.time-display>span').innerText();
    await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
    assert.equal(await page.locator('.error-banner').count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.equal(
    createHash('sha256')
      .update(await readFile(inputPath))
      .digest('hex'),
    hash,
  );
  const report = {
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    layers: 7,
    pointsPerStroke: 512,
    compositeLayers: 7,
    operationsPerLayer: 3,
    perChannelEraserAndRectangle: true,
    channels: 2,
    sourceRate: rate,
    concurrentSpectrogramAnalysis: true,
    playbackPositions: positions,
    sourceUnchanged: true,
    pageErrors: errors,
  };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/native-brush-playback.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
