import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

// Isolated packaged WebView: native source reads, conversion, the actual MIDI
// save dialog/IPC, and source overwrite rejection. No playback or user files.
const temp = await mkdtemp(join(tmpdir(), 'tonalia-native-midi-'));
const inputPath = join(temp, 'melody.wav'),
  outputPath = join(temp, 'melody.mid');
const rate = 48000,
  frames = rate * 2;
const input = Buffer.alloc(44 + frames * 2);
input.write('RIFF');
input.writeUInt32LE(input.length - 8, 4);
input.write('WAVEfmt ', 8);
input.writeUInt32LE(16, 16);
input.writeUInt16LE(1, 20);
input.writeUInt16LE(1, 22);
input.writeUInt32LE(rate, 24);
input.writeUInt32LE(rate * 2, 28);
input.writeUInt16LE(2, 32);
input.writeUInt16LE(16, 34);
input.write('data', 36);
input.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) {
  const t = i / rate,
    index = Math.floor((t - 0.2) / 0.6);
  const local = t - (0.2 + index * 0.6);
  if (index < 0 || index > 2 || local < 0 || local >= 0.4) continue;
  const hz = 440 * 2 ** (([60, 64, 69][index] - 69) / 12);
  const envelope = Math.min(1, local / 0.01, (0.4 - local) / 0.01);
  input.writeInt16LE(
    Math.round(envelope * 0.3 * Math.sin(2 * Math.PI * hz * t) * 32767),
    44 + i * 2,
  );
}
await writeFile(inputPath, input);
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
      WEBVIEW2_USER_DATA_FOLDER: join(temp, 'webview-profile'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: 'ignore',
  },
);
let browser;
try {
  let available = false;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        available = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(available, 'Packaged WebView did not start.');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let i = 0; i < 100; i++) {
    page = browser
      .contexts()[0]
      .pages()
      .find((p) => /tauri\.localhost|tauri:\/\//.test(p.url()));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(page, 'No Tonalia WebView found.');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByText(/2048 FFT/).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await page.getByText('3 notes detected', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Export MIDI', exact: true }).evaluate((el) => el.click());
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'RemoteSigned',
      '-File',
      resolve('tests/native/file-dialog.ps1'),
      '-ApplicationPid',
      String(child.pid),
      '-FilePath',
      outputPath,
    ],
    { timeout: 30000, stdio: 'inherit' },
  );
  await page.getByText('MIDI exported', { exact: true }).waitFor({ timeout: 30000 });
  const midi = await readFile(outputPath);
  assert.equal(midi.toString('ascii', 0, 4), 'MThd');
  assert.equal(midi.readUInt16BE(8), 1);
  assert.equal(midi.readUInt16BE(10), 2);
  assert.equal(midi.readUInt16BE(12), 960);
  let at = 14;
  const pitches = [];
  for (let track = 0; track < 2; track++) {
    assert.equal(midi.toString('ascii', at, at + 4), 'MTrk');
    const end = at + 8 + midi.readUInt32BE(at + 4);
    at += 8;
    const variable = () => {
      let n = 0,
        b;
      do {
        b = midi[at++];
        n = n * 128 + (b & 127);
      } while (b & 128);
      return n;
    };
    while (at < end) {
      variable();
      const status = midi[at++];
      if (status === 255) {
        at++;
        const size = variable();
        at += size;
      } else {
        const pitch = midi[at++],
          velocity = midi[at++];
        if ((status & 0xf0) === 0x90 && velocity) pitches.push(pitch);
      }
    }
  }
  assert.deepEqual(pitches, [60, 64, 69]);
  const rejection = await page.evaluate(
    async ({ path, bytes }) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('save_midi', { path, bytes });
        return '';
      } catch (e) {
        return String(e);
      }
    },
    { path: inputPath, bytes: Array.from(midi) },
  );
  assert.match(rejection, /source|overwrite/i);
  assert.deepEqual(await readFile(inputPath), input);
  const invalidPath = join(temp, 'invalid.mid');
  const invalid = await page.evaluate(async (path) => {
    try {
      await window.__TAURI_INTERNALS__.invoke('save_midi', { path, bytes: [0, 1, 2] });
      return '';
    } catch (e) {
      return String(e);
    }
  }, invalidPath);
  assert.match(invalid, /Invalid MIDI/);
  await assert.rejects(access(invalidPath));
  assert.deepEqual(errors, []);
  console.log(
    'Native MIDI passed: known melody, real save dialog, SMF note data, source preservation, invalid-file rejection.',
  );
} finally {
  await browser?.close().catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
}
