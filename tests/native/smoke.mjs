import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

// Test the packaged WebView and real native commands. The source is opened through the supported command-line path. Native export/project commands are exercised directly.
// No user recordings or browser profiles are touched. Native output is deliberately quiet.
const temp = await mkdtemp(join(tmpdir(), 'tonalia-native-smoke-'));
const inputPath = join(temp, 'native-reference.wav');
const outputPath = join(temp, 'native-export.wav');
const projectPath = join(temp, 'native-project.tonalia.json');
const rate = 48000,
  frames = rate * 4;
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
  const v = Math.round(Math.sin((2 * Math.PI * 937.5 * i) / rate) * 3000);
  input.writeInt16LE(v, 44 + i * 4);
  input.writeInt16LE(-v, 46 + i * 4);
}
await writeFile(inputPath, input);
const port = await new Promise((resolvePort) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const p = server.address().port;
    server.close(() => resolvePort(p));
  });
});
const executable =
  process.env.TONALIA_TEST_EXECUTABLE || resolve('target/release/tonalia-desktop.exe');
const offline = process.env.TONALIA_TEST_OFFLINE === '1';
const reportFile = process.env.TONALIA_TEST_REPORT || 'docs/implementation/native-smoke.json';
const networkArguments = offline
  ? ' --proxy-server=http://127.0.0.1:9 --proxy-bypass-list="*.localhost;localhost;127.0.0.1" --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE ipc.localhost, EXCLUDE tauri.localhost, EXCLUDE 127.0.0.1"'
  : '';
const child = spawn(executable, [inputPath], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}${networkArguments}`,
  },
  stdio: 'ignore',
});
let browser;
try {
  let available = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        available = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(available, 'The packaged WebView did not expose its test-only CDP endpoint.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const externalRequests = [];
  if (offline) {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (
        ['tauri.localhost', 'ipc.localhost', 'localhost', '127.0.0.1'].includes(url.hostname) ||
        !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
      )
        return route.continue();
      externalRequests.push(url.origin);
      return route.abort('internetdisconnected');
    });
  }
  let page;
  for (let i = 0; i < 100; i++) {
    page = context.pages().find((p) => /tauri\.localhost|tauri:\/\//.test(p.url()));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(page, 'No Tonalia WebView page was found.');
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('NATIVE JS', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('NATIVE CONSOLE', m.text());
  });
  await page.getByRole('button', { name: 'Open WAV', exact: true }).waitFor({ timeout: 15000 });
  const opened = performance.now();
  await page.getByText('SHA-256 verified', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByText(/2048 FFT/).waitFor({ timeout: 20000 });
  const loadMs = performance.now() - opened;
  const number = async (label, value) => {
    const field = page.getByRole('textbox', { name: label, exact: true });
    await field.fill(value);
    await field.evaluate((el) => el.blur());
  };
  await number('Start', '0.5');
  await number('End', '1.5');
  await number('Low frequency', '750');
  await number('High frequency', '1200');
  await page.getByLabel('Target channels').selectOption('0');
  await page.getByRole('button', { name: '-6 dB', exact: true }).evaluate((el) => el.click());
  await page
    .getByRole('button', { name: 'Create gain layer', exact: true })
    .evaluate((el) => el.click());
  await page.getByRole('button', { name: 'Delete Spectral attenuation' }).waitFor();
  await page.getByLabel('Monitor volume').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '-36');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Play audio', exact: true }).evaluate((el) => el.click());
  await page.waitForFunction(
    () => document.querySelector('.time-display>span')?.textContent !== '0:00.000',
    undefined,
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
  const nativePlaybackPosition = await page.locator('.time-display>span').innerText();
  await page
    .getByRole('button', { name: 'Pause playback', exact: true })
    .evaluate((el) => el.click());
  const alerts = await page.getByRole('alert').allTextContents();
  assert.deepEqual(alerts, [], 'Native playback reported an error.');
  await page
    .getByRole('button', { name: 'Export audio', exact: true })
    .evaluate((el) => el.click());
  await page.getByLabel('Export precision').selectOption('64');
  const layer = {
    id: 'native-test-layer',
    name: 'Spectral attenuation',
    enabled: true,
    gainDb: -6,
    mask: {
      shape: { kind: 'rectangle', start: 24000, end: 72000, low: 750, high: 1200 },
      channel: 0,
      featherTime: 240,
      featherHz: 48000 / 2048,
    },
  };
  await page.getByRole('button', { name: 'Close export' }).evaluate((el) => el.click());
  await page.evaluate(
    ({ outputPath, layer }) =>
      window.__TAURI_INTERNALS__.invoke('export_audio', {
        id: '1',
        request: { path: outputPath, layers: [layer], start: 0, end: 192000, bits: 64 },
      }),
    { outputPath, layer },
  );
  const output = await readFile(outputPath);
  assert.equal(output.readUInt32LE(24), rate);
  assert.equal(output.readUInt16LE(34), 64);
  assert.equal(output.length, 44 + frames * 16);
  let rightError = 0,
    outsideError = 0,
    beforePower = 0,
    afterPower = 0;
  for (let i = 0; i < frames; i++) {
    const left = input.readInt16LE(44 + i * 4) / 32768,
      right = input.readInt16LE(46 + i * 4) / 32768,
      actual = output.readDoubleLE(44 + i * 16);
    rightError = Math.max(rightError, Math.abs(output.readDoubleLE(52 + i * 16) - right));
    if (i < 20000 || i > 75000) outsideError = Math.max(outsideError, Math.abs(actual - left));
    if (i > 35000 && i < 55000) {
      beforePower += left * left;
      afterPower += actual * actual;
    }
  }
  assert.equal(rightError, 0);
  assert.equal(outsideError, 0);
  const gainDb = 10 * Math.log10(afterPower / beforePower);
  assert(Math.abs(gainDb + 6) < 0.01);
  const hash = (b) => createHash('sha256').update(b).digest('hex');
  assert.equal(hash(await readFile(inputPath)), hash(input));
  // Verify that even an explicitly selected source output path is refused by the native boundary.
  const prevented = await page.evaluate(
    async ({ inputPath }) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('export_audio', {
          id: '1',
          request: { path: inputPath, layers: [], start: 0, end: 1, bits: 64 },
        });
        return false;
      } catch (e) {
        return String(e).includes('never overwrites');
      }
    },
    { inputPath },
  );
  assert(prevented, 'The native source-overwrite guard did not reject the original WAV.');
  const manifest = {
    format: 'tonalia',
    schema: 1,
    engine: 'spectral-gain-v1',
    fftSize: 2048,
    source: {
      name: 'native-reference.wav',
      size: input.length,
      sha256: hash(input),
      sampleRate: rate,
      channels: 2,
      frames,
    },
    layers: [layer],
    view: { start: 0, end: frames, low: 20, high: 24000, log: true },
  };
  await page.evaluate(
    ({ projectPath, manifest }) =>
      window.__TAURI_INTERNALS__.invoke('save_project', {
        path: projectPath,
        contents: JSON.stringify(manifest),
      }),
    { projectPath, manifest },
  );
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  assert.equal(project.layers.length, 1);
  assert.equal(project.source.sha256, hash(input));
  const projectOverwritePrevented = await page.evaluate(
    async ({ inputPath, manifest }) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('save_project', {
          path: inputPath,
          contents: JSON.stringify(manifest),
        });
        return false;
      } catch (e) {
        return String(e).includes('never overwrites');
      }
    },
    { inputPath, manifest },
  );
  assert(projectOverwritePrevented, 'Project save must also protect the original recording.');
  assert.equal(hash(await readFile(inputPath)), hash(input));
  const candidatePreserved = await page.evaluate(
    async ({ inputPath }) => {
      const ipc = window.__TAURI_INTERNALS__;
      const candidate = await ipc.invoke('open_source', { path: inputPath });
      await ipc.invoke('release_source', { id: candidate.id });
      const header = await ipc.invoke('read_source_range', { id: '1', offset: 0, length: 4 });
      return Array.from(new Uint8Array(header)).join(',') === '82,73,70,70';
    },
    { inputPath },
  );
  assert(candidatePreserved, 'Releasing an unaccepted source invalidated the current source.');
  await page.getByText(/2048 FFT/).waitFor({ timeout: 60000 });
  await mkdir('docs/implementation', { recursive: true });
  await page.screenshot({ path: reportFile.replace(/\.json$/, '.png') });
  const report = {
    date: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    webview: browser.version(),
    nativeIpc: true,
    executable: executable.replace(process.env.USERPROFILE || '\u0000', '%USERPROFILE%'),
    offlineWebView: offline,
    networkIsolation: offline
      ? 'Outbound HTTP(S) uses an unreachable per-process proxy; external DNS is blocked. Local Tauri IPC remains available. Browser routing also rejects external origins.'
      : null,
    externalRequests,
    sourceLoadAndAnalysisMs: Math.round(loadMs),
    nativePlaybackPosition,
    nativePlaybackErrors: alerts,
    exportFrames: frames,
    exportRate: rate,
    exportBits: 64,
    measuredGainDb: gainDb,
    untouchedRightChannelMaxError: rightError,
    outsideSupportMaxError: outsideError,
    sourceBytesUnchanged: true,
    sourceOverwritePrevented: prevented,
    nativeProjectSaved: true,
    projectSourceOverwritePrevented: projectOverwritePrevented,
    cancelledCandidatePreservesCurrentSource: candidatePreserved,
    pageErrors: errors,
    qualification:
      'Development smoke test only. No physical loopback, latency or long-session qualification.',
  };
  assert.deepEqual(errors, []);
  if (offline)
    assert.deepEqual(externalRequests, [], 'The installed app attempted an external request.');
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (browser) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        console.error('NATIVE PAGE', page.url());
        console.error(
          (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(0, 6000),
        );
        await page.screenshot({ path: 'test-results/native-failure.png' }).catch(() => {});
      }
    }
  }
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
