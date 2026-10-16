import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

// Real PANNs/AudioSep inference through the packaged UI. The upstream reference
// contains a telephone bell and speech, outside the former example preset list.
const temp = await mkdtemp(join(tmpdir(), 'tonalia-auto-separation-'));
const inputPath = join(temp, 'Telephone and speech.wav');
const fixture = process.env.TONALIA_TEST_AI_FIXTURE
  ? await readFile(process.env.TONALIA_TEST_AI_FIXTURE)
  : Buffer.from(
      await (
        await fetch(
          'https://raw.githubusercontent.com/ailia-ai/ailia-models/c6acc5de9476e47ecee49624f01a9bc766da2df1/audio_processing/audioset_tagging_cnn/R9_ZSCveAHg_7s.wav',
        )
      ).arrayBuffer(),
    );
const hash = createHash('sha256').update(fixture).digest('hex');
assert.equal(hash, '59429c7174a3707575581d0b4181b1e2a420bda5d1de8d5195cf0b1e07d8bdfd');
await writeFile(inputPath, fixture);
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
  stdio: ['ignore', 'ignore', 'pipe'],
});
let nativeDiagnostics = '';
child.stderr.on('data', (chunk) => {
  nativeDiagnostics += chunk.toString();
});
child.on('exit', (code, signal) => {
  console.log(`Test app exit: ${code}, signal: ${signal}`);
});
const aiRoot = process.env.TONALIA_AI_HOME || join(process.env.LOCALAPPDATA, 'Tonalia', 'ai-v1');
const jobs = new Set();
let browser;
async function latestJob(mode) {
  const matches = [];
  for (const name of await readdir(join(aiRoot, 'jobs'))) {
    try {
      const result = JSON.parse(await readFile(join(aiRoot, 'jobs', name, 'result.json'), 'utf8'));
      if (result.mode === mode && result.sourceHash === hash && result.sourcePath === inputPath) {
        jobs.add(result.id);
        matches.push(result);
      }
    } catch {}
  }
  assert(matches.length, `No completed ${mode} job for this source`);
  return matches.at(-1);
}
function samples(wav) {
  for (let at = 12; at + 8 <= wav.length;) {
    const size = wav.readUInt32LE(at + 4);
    if (wav.toString('ascii', at, at + 4) === 'data') return wav.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error('Missing WAV data');
}
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  if (process.env.TONALIA_SCREENSHOT_AI) await page.setViewportSize({ width: 1600, height: 1000 });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('SHA-256 verified', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Separate sounds', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Separate sounds', exact: true });
  assert.equal(
    await dialog
      .getByRole('tab', { name: 'Auto separate', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  assert.equal(await dialog.locator('.separation-presets button').count(), 0);
  const before = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('ai_status'));
  // A detector update must retain verified music/extraction packs from 0.3.
  assert(before.music && before.sound && before.runtimeReady);
  await page.waitForFunction(
    () =>
      document.querySelector('.separation-install') ||
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.includes('Analyse and separate') && !b.disabled,
      ),
  );
  if (await dialog.getByRole('button', { name: 'Install AI pack', exact: true }).isVisible()) {
    await dialog.getByRole('button', { name: 'Install AI pack', exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent.includes('Analyse and separate') && !b.disabled,
      ),
    );
  }
  await dialog.getByRole('tab', { name: 'Find sounds', exact: true }).click();
  await dialog.getByRole('button', { name: 'Find sounds', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Extract Telephone bell ringing', exact: true })
    .waitFor();
  const analysis = await latestJob('identify');
  assert.deepEqual(
    new Set(analysis.sources.map((s) => s.label)),
    new Set(['Speech', 'Telephone bell ringing']),
  );
  assert.equal(await dialog.locator('.separated-track').count(), 0);
  assert(analysis.modelAssets.some((a) => a.name === 'panns_sound_event_detection.onnx'));
  assert(!analysis.modelAssets.some((a) => a.name.includes('msclap')));
  await dialog.getByRole('button', { name: 'Extract Telephone bell ringing', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Preview Telephone bell ringing', exact: true })
    .waitFor();
  assert(await dialog.isVisible(), 'Extract must create audio without closing to draw a rectangle');
  const direct = await latestJob('sound');
  assert.equal(direct.tracks.length, 2);
  assert.equal(direct.tracks[0].name, 'Telephone bell ringing');
  await dialog.getByRole('tab', { name: 'Isolate a sound', exact: true }).click();
  await dialog.getByRole('button', { name: /^Speech · / }).waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: 'Sound description' }).inputValue(), '');
  await dialog.getByRole('tab', { name: 'Auto separate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Analyse and separate', exact: true }).click();
  await dialog.getByRole('button', { name: 'Preview Speech', exact: true }).waitFor();
  const automatic = await latestJob('auto');
  assert.equal(automatic.schema, 2);
  assert.equal(automatic.cleanup, 0.55);
  assert.equal(automatic.tracks.length, 3);
  const pcm = await Promise.all(automatic.tracks.map(async (t) => samples(await readFile(t.path))));
  const original = samples(fixture);
  let reconstructionError = 0;
  for (let i = 0; i < automatic.tracks[0].frames; i++) {
    reconstructionError = Math.max(
      reconstructionError,
      Math.abs(
        pcm.reduce((sum, buffer) => sum + buffer.readFloatLE(i * 4), 0) -
          original.readInt16LE(i * 2) / 32768,
      ),
    );
  }
  assert(reconstructionError < 1e-6);
  await dialog.getByRole('button', { name: 'Preview Speech', exact: true }).click();
  await dialog.getByRole('button', { name: 'Stop preview Speech', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Stop preview Speech', exact: true }).click();
  const exported = await page.evaluate(
    ({ jobId, destination }) =>
      window.__TAURI_INTERNALS__.invoke('ai_export_tracks', { jobId, destination }),
    { jobId: automatic.id, destination: temp },
  );
  assert.equal(exported, 3);
  await page.screenshot({ path: 'test-results/native-auto-separation.png', fullPage: true });
  if (process.env.TONALIA_SCREENSHOT_AI)
    await page.screenshot({ path: process.env.TONALIA_SCREENSHOT_AI });
  await dialog.getByRole('slider', { name: 'Minimum detection score', exact: true }).fill('0.95');
  await dialog.getByRole('button', { name: 'Analyse and separate', exact: true }).click();
  await dialog.getByText(/No sources met the confidence threshold/).waitFor();
  assert.equal(await dialog.locator('.separated-track').count(), 1);
  assert.equal(await dialog.locator('.detected-source').count(), 0);
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('ai_status'));
  assert(status.music && status.sound && status.identify && !status.busy);
  assert.equal(
    createHash('sha256')
      .update(await readFile(inputPath))
      .digest('hex'),
    hash,
  );
  assert.deepEqual(errors, []);
  const report = {
    executable,
    version: JSON.parse(await readFile('package.json', 'utf8')).version,
    sources: analysis.sources,
    analysisDrivenSuggestions: true,
    noExamplePresets: true,
    directExtraction: true,
    automaticTracks: automatic.tracks.length,
    spectralCleanup: automatic.cleanup,
    reconstructionMaxError: reconstructionError,
    nativePreview: true,
    nativeTrackExport: exported,
    confidenceAbstention: true,
    retainedExistingPacks: before.music && before.sound,
    sourceUnchanged: true,
    pageErrors: errors,
  };
  await writeFile('test-results/native-auto-separation.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Native exit: ${child.exitCode}; diagnostics: ${nativeDiagnostics.slice(-4000)}`);
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.error((await page.locator('body').innerText()).slice(-6000));
      await page
        .screenshot({ path: 'test-results/native-auto-separation-failure.png' })
        .catch(() => {});
    }
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  // Discover all jobs created by this unique test input, including the abstention job.
  try {
    for (const entry of await readdir(join(aiRoot, 'jobs'))) {
      try {
        const r = JSON.parse(await readFile(join(aiRoot, 'jobs', entry, 'result.json'), 'utf8'));
        if (r.sourcePath === inputPath) jobs.add(entry);
      } catch {}
    }
  } catch {}
  for (const id of jobs)
    await rm(join(aiRoot, 'jobs', id), { recursive: true, force: true }).catch(() => {});
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
