import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const temp = await mkdtemp(join(tmpdir(), 'tonalia-ai-smoke-'));
const inputPath = join(temp, 'Quiet clicks and tones.wav');
const rate = 48000,
  frames = rate * 2;
const source = Buffer.alloc(44 + frames * 4);
source.write('RIFF');
source.writeUInt32LE(source.length - 8, 4);
source.write('WAVEfmt ', 8);
source.writeUInt32LE(16, 16);
source.writeUInt16LE(1, 20);
source.writeUInt16LE(2, 22);
source.writeUInt32LE(rate, 24);
source.writeUInt32LE(rate * 4, 28);
source.writeUInt16LE(4, 32);
source.writeUInt16LE(16, 34);
source.write('data', 36);
source.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  const click = i === rate ? 0.3 : 0;
  source.writeInt16LE(
    Math.round((0.06 * Math.sin((2 * Math.PI * 440 * i) / rate) + click) * 32767),
    44 + i * 4,
  );
  source.writeInt16LE(
    Math.round((0.03 * Math.sin((2 * Math.PI * 660 * i) / rate) - click) * 32767),
    46 + i * 4,
  );
}
await writeFile(inputPath, source);
const hash = createHash('sha256').update(source).digest('hex');
const port = await new Promise((done) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => done(port));
  });
});
const child = spawn(
  process.env.TONALIA_TEST_EXECUTABLE || resolve('target/release/tonalia-desktop.exe'),
  [inputPath],
  {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(temp, 'profile'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: 'ignore',
  },
);
let browser;
const jobs = [];
const aiRoot = process.env.TONALIA_AI_HOME || join(process.env.LOCALAPPDATA, 'Tonalia', 'ai-v1');
const readJob = async (mode) => {
  for (const name of await readdir(join(aiRoot, 'jobs'))) {
    try {
      const result = JSON.parse(await readFile(join(aiRoot, 'jobs', name, 'result.json'), 'utf8'));
      if (result.mode === mode && result.sourceHash === hash && result.sourcePath === inputPath)
        return result;
    } catch {}
  }
  throw new Error(`No completed ${mode} job for the test source.`);
};
const wavData = (buffer) => {
  for (let at = 12; at + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(at + 4);
    if (buffer.toString('ascii', at, at + 4) === 'data')
      return buffer.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error('No WAV samples');
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('SHA-256 verified', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Separate sounds', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Separate sounds', exact: true });
  await dialog.getByRole('tab', { name: 'Music stems', exact: true }).click();
  const install = dialog.getByRole('button', { name: 'Install AI pack', exact: true });
  // Exercise the actual installer when the model has not yet been verified on this machine.
  await page.waitForFunction(
    () =>
      document.querySelector('.separation-install') ||
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent.includes('Split into tracks') && !button.disabled,
      ),
  );
  if (await install.isVisible()) await install.click();
  await dialog.getByRole('button', { name: 'Split into tracks', exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (button) => button.textContent.includes('Split into tracks') && !button.disabled,
      ),
    undefined,
    { timeout: 180000 },
  );
  await dialog.getByRole('button', { name: 'Split into tracks', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Preview Vocals', exact: true })
    .waitFor({ timeout: 120000 });
  const music = await readJob('music');
  jobs.push(music.id);
  assert.equal(music.tracks.length, 7);
  assert(
    music.tracks.every(
      (track) => track.sampleRate === rate && track.frames === frames && track.channels === 2,
    ),
  );
  const stemData = await Promise.all(
    music.tracks.map(async (track) => wavData(await readFile(track.path))),
  );
  let reconstructionError = 0;
  for (let i = 0; i < frames * 2; i++)
    reconstructionError = Math.max(
      reconstructionError,
      Math.abs(
        stemData.reduce((sum, pcm) => sum + pcm.readFloatLE(i * 4), 0) -
          source.readInt16LE(44 + i * 2) / 32768,
      ),
    );
  assert(reconstructionError < 1e-6);
  await dialog.getByRole('button', { name: 'Preview Vocals', exact: true }).click();
  await dialog.getByRole('button', { name: 'Stop preview Vocals', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Stop preview Vocals', exact: true }).click();
  const exported = await page.evaluate(
    ({ jobId, destination }) =>
      window.__TAURI_INTERNALS__.invoke('ai_export_tracks', { jobId, destination }),
    { jobId: music.id, destination: temp },
  );
  assert.equal(exported, 7);
  const manifest = JSON.parse(
    await readFile(join(temp, `Tonalia-${music.id}`, 'separation.json'), 'utf8'),
  );
  assert(manifest.tracks.every((track) => !/[\\/]/.test(track.path)));
  await dialog.getByRole('tab', { name: 'Tiny clicks', exact: true }).click();
  await dialog.getByRole('button', { name: 'Find tiny clicks', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Preview Brief transients', exact: true })
    .waitFor({ timeout: 30000 });
  const clicks = await readJob('transients');
  jobs.push(clicks.id);
  assert(clicks.events.some((event) => event.start <= 1 && event.end >= 1));
  assert(clicks.events.every((event) => event.label === 'Brief transient'));
  await page.screenshot({ path: 'test-results/native-separation.png' });
  // Verify the cache setup for the other packs without uploading media.
  for (const pack of ['sound', 'identify'])
    await page.evaluate(
      (pack) => window.__TAURI_INTERNALS__.invoke('ai_prepare', { pack, jobId: `prepare-${pack}` }),
      pack,
    );
  const cancelId = `cancel-${Date.now()}`;
  await page.evaluate(
    ({ hash, frames, cancelId }) => {
      window.__AI_CANCEL_TEST__ = window.__TAURI_INTERNALS__
        .invoke('ai_start', {
          id: '1',
          jobId: cancelId,
          request: {
            mode: 'sound',
            start: 0,
            end: frames,
            prompt: 'a lighter clicking',
            prompts: ['a lighter clicking'],
            sensitivity: 0.6,
            sourceHash: hash,
          },
        })
        .then(
          () => 'unexpected success',
          (error) => String(error),
        );
    },
    { hash, frames, cancelId },
  );
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('ai_cancel'));
  assert.match(await page.evaluate(() => window.__AI_CANCEL_TEST__), /cancelled/i);
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('ai_status'));
  assert(status.music && status.sound && status.identify && !status.busy);
  await dialog
    .locator('.separated-track')
    .first()
    .getByRole('button', { name: 'Open in editor', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('track-01.wav', { exact: true }).first().waitFor();
  assert.equal(
    createHash('sha256')
      .update(await readFile(inputPath))
      .digest('hex'),
    hash,
  );
  assert.deepEqual(errors, []);
  const report = {
    localModels: true,
    nativeMusicTracks: 7,
    reconstructionMaxError: reconstructionError,
    quietClickCandidates: clicks.events.length,
    preview: true,
    nativeTrackExport: true,
    cancellation: true,
    openTrackInEditor: true,
    modelPacks: status,
    sourceUnchanged: true,
    pageErrors: errors,
  };
  await writeFile('test-results/native-separation.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.error((await page.locator('body').innerText()).slice(-8000));
      await page.screenshot({ path: 'test-results/native-separation-failure.png' }).catch(() => {});
    }
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  for (const job of jobs)
    await rm(
      join(
        process.env.TONALIA_AI_HOME || join(process.env.LOCALAPPDATA, 'Tonalia', 'ai-v1'),
        'jobs',
        job,
      ),
      { recursive: true, force: true },
    ).catch(() => {});
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
