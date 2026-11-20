import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  detectPitch,
  identifyNote,
  noteHz,
  NoteTracker,
  PITCH_RATE,
  PITCH_WINDOW,
  type NoteConversion,
} from '../../apps/web/src/engine/notes';
import { encodeMidi } from '../../apps/web/src/engine/midi';

test('identifies equal-tempered notes and cents; YIN follows fundamentals under louder harmonics', () => {
  expect(identifyNote(440)).toEqual({ midi: 69, name: 'A4', cents: 0 });
  expect(identifyNote(noteHz(60) * 2 ** (23 / 1200))).toEqual({ midi: 60, name: 'C4', cents: 23 });
  expect(identifyNote(0)).toBeNull();
  expect(identifyNote(NaN)).toBeNull();
  for (const midi of [24, 36, 48, 60, 64, 69, 84, 96]) {
    const hz = noteHz(midi);
    const frame = Float32Array.from(
      { length: PITCH_WINDOW },
      (_, i) =>
        0.08 * Math.sin((2 * Math.PI * hz * i) / PITCH_RATE) +
        0.15 * Math.sin((4 * Math.PI * hz * i) / PITCH_RATE) +
        0.03 * Math.sin((6 * Math.PI * hz * i) / PITCH_RATE),
    );
    const pitch = detectPitch(frame, -48);
    expect(pitch?.midi, `MIDI ${midi}`).toBe(midi);
    expect(pitch!.confidence).toBeGreaterThan(0.85);
    expect(Math.abs(1200 * Math.log2(pitch!.hz / hz))).toBeLessThan(35);
  }
});

test('silence, DC, unpitched noise and signals below the gate produce no notes', () => {
  expect(detectPitch(new Float32Array(PITCH_WINDOW), -60)).toBeNull();
  expect(detectPitch(new Float32Array(PITCH_WINDOW).fill(0.4), -60)).toBeNull();
  let seed = 17;
  const noise = Float32Array.from({ length: PITCH_WINDOW }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.3;
  });
  expect(detectPitch(noise, -60)).toBeNull();
  expect(
    detectPitch(
      Float32Array.from(
        { length: PITCH_WINDOW },
        (_, i) => 0.0001 * Math.sin((2 * Math.PI * 440 * i) / PITCH_RATE),
      ),
      -48,
    ),
  ).toBeNull();
});

test('note segmentation rejects short blips and bridges a single uncertain frame', () => {
  const tracker = new NoteTracker(0, 60);
  const a = { midi: 69, hz: 440, confidence: 0.99, rms: 0.1 };
  [a, a, a, null, a, a, null, null].forEach((p, i) => tracker.push(p, i * 20, (i + 1) * 20));
  tracker.flush();
  expect(tracker.notes).toHaveLength(1);
  expect(tracker.notes[0].start).toBe(0);
  expect(tracker.notes[0].end).toBe(120);
  const short = new NoteTracker(0, 60);
  [a, a, null, null].forEach((p, i) => short.push(p, i * 20, (i + 1) * 20));
  short.flush();
  expect(short.notes).toHaveLength(0);
});

function parseMidi(input: Uint8Array) {
  const data = Buffer.from(input);
  expect(data.toString('ascii', 0, 4)).toBe('MThd');
  expect(data.readUInt32BE(4)).toBe(6);
  expect(data.readUInt16BE(8)).toBe(1);
  expect(data.readUInt16BE(12)).toBe(960);
  let at = 14;
  const events: { tick: number; status: number; note: number; velocity: number; track: number }[] =
    [];
  const variable = () => {
    let value = 0,
      byte = 0;
    do {
      byte = data[at++];
      value = value * 128 + (byte & 127);
    } while (byte & 128);
    return value;
  };
  for (let track = 0; track < data.readUInt16BE(10); track++) {
    expect(data.toString('ascii', at, at + 4)).toBe('MTrk');
    const end = at + 8 + data.readUInt32BE(at + 4);
    at += 8;
    let tick = 0;
    while (at < end) {
      tick += variable();
      const status = data[at++];
      if (status === 255) {
        const type = data[at++],
          size = variable();
        if (type === 81) expect(data.readUIntBE(at, size)).toBe(500000);
        at += size;
      } else {
        events.push({ tick, status, note: data[at++], velocity: data[at++], track });
      }
    }
    expect(at).toBe(end);
  }
  expect(at).toBe(data.length);
  return events;
}

test('MIDI preserves relative timing and channels and orders note-offs before repeated note-ons', () => {
  const conversion: NoteConversion = {
    start: 48000,
    end: 48000 * 4,
    sampleRate: 48000,
    signal: 'original',
    notes: [
      {
        start: 48000,
        end: 96000,
        midi: 60,
        velocity: 90,
        channel: 0,
        hz: noteHz(60),
        confidence: 1,
      },
      {
        start: 96000,
        end: 144000,
        midi: 60,
        velocity: 80,
        channel: 0,
        hz: noteHz(60),
        confidence: 1,
      },
      {
        start: 72000,
        end: 168000,
        midi: 67,
        velocity: 70,
        channel: 1,
        hz: noteHz(67),
        confidence: 1,
      },
    ],
  };
  const events = parseMidi(encodeMidi(conversion));
  expect(events.filter((e) => e.status === 0x90).map((e) => e.tick)).toEqual([0, 1920]);
  expect(events.filter((e) => e.tick === 1920).map((e) => e.status)).toEqual([0x80, 0x90]);
  expect(events.find((e) => e.status === 0x91)).toMatchObject({
    tick: 960,
    note: 67,
    velocity: 70,
  });
});

function melody(silent = false) {
  const rate = 48000,
    frames = rate * 2;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  if (!silent)
    for (let i = 0; i < frames; i++) {
      const t = i / rate;
      const index = Math.floor((t - 0.2) / 0.6);
      const local = t - (0.2 + index * 0.6);
      if (index < 0 || index > 2 || local < 0 || local >= 0.4) continue;
      const hz = noteHz([60, 64, 69][index]);
      const envelope = Math.min(1, local / 0.01, (0.4 - local) / 0.01);
      const value = Math.round(
        envelope *
          (0.15 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(4 * Math.PI * hz * t)) *
          32767,
      );
      buffer.writeInt16LE(value, 44 + i * 4);
      buffer.writeInt16LE(-value, 46 + i * 4);
    }
  return { name: silent ? 'Silence.wav' : 'Known melody.wav', mimeType: 'audio/wav', buffer };
}

test('converts imported audio beside the spectrum, exports measured MIDI, and clears notes on source change', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Import WAV').setInputFiles(melody());
  await expect(page.getByText(/2048 FFT/)).toBeVisible();
  const workbench = page.getByLabel('Notes and MIDI', { exact: true });
  await expect(workbench.getByRole('button', { name: 'Export MIDI' })).toBeDisabled();
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await expect(page.getByText('6 notes detected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fit detected notes' }).click();
  await expect(page.getByTestId('detected-note')).toHaveCount(6);
  await expect(page.getByTestId('note-ruler-tick').first()).toBeVisible();
  await page.evaluate(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  );
  const downloadPromise = page.waitForEvent('download');
  await workbench.getByRole('button', { name: 'Export MIDI' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Known melody-notes.mid');
  const events = parseMidi(await readFile((await download.path())!));
  for (const channel of [0, 1]) {
    const on = events.filter((e) => e.status === (0x90 | channel));
    const off = events.filter((e) => e.status === (0x80 | channel));
    expect(on.map((e) => e.note)).toEqual([60, 64, 69]);
    on.forEach((e, i) => expect(Math.abs(e.tick / 1920 - (0.2 + i * 0.6))).toBeLessThan(0.08));
    off.forEach((e, i) => expect(Math.abs(e.tick / 1920 - (0.6 + i * 0.6))).toBeLessThan(0.08));
  }
  await page.getByRole('checkbox', { name: 'Note ruler' }).uncheck();
  await expect(page.getByTestId('detected-note')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Note ruler' }).check();
  await expect(page.getByTestId('detected-note')).toHaveCount(6);
  await page.screenshot({ path: 'test-results/notes-viewer.png' });
  // The selected time range is rebased to zero in MIDI, with original times on the spectrum.
  for (const [label, value] of [
    ['Start', '0.8'],
    ['End', '1.2'],
  ]) {
    const input = page.getByRole('textbox', { name: label, exact: true });
    await input.fill(value);
    await input.press('Enter');
  }
  await page.getByLabel('Note conversion range', { exact: true }).selectOption('selection');
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await expect(page.getByText('2 notes detected', { exact: true })).toBeVisible();
  const rangeDownload = page.waitForEvent('download');
  await workbench.getByRole('button', { name: 'Export MIDI' }).click();
  const rangeEvents = parseMidi(await readFile((await (await rangeDownload).path())!));
  expect(rangeEvents.filter((e) => (e.status & 0xf0) === 0x90).map((e) => e.note)).toEqual([
    64, 64,
  ]);
  expect(rangeEvents[0].tick).toBeLessThan(100);
  await page.getByLabel('Import WAV').setInputFiles(melody(true));
  await expect(page.getByText('Silence.wav', { exact: true }).first()).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export MIDI' })).toBeDisabled();
  await expect(page.getByTestId('detected-note')).toHaveCount(0);
  await page.getByLabel('Note conversion range', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await expect(page.getByText(/No stable notes found/)).toBeVisible();
  await expect(workbench.getByRole('button', { name: 'Export MIDI' })).toBeDisabled();
});

test('MIDI stays independent of display settings, reflects Result edits, and supports the browser file picker', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByLabel('Import WAV').setInputFiles(melody());
  await expect(page.getByText(/2048 FFT/)).toBeVisible();
  await page.getByRole('button', { name: 'Conversion settings', exact: true }).click();
  await page.getByLabel('Note conversion channel', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: 'Close conversion settings', exact: true }).click();
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await expect(page.getByText('3 notes detected', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const outputs: number[][] = [];
    Object.assign(window, { midiOutputs: outputs });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'Melody.mid',
        createWritable: async () => ({
          write: async (bytes: Uint8Array) => {
            outputs.push(Array.from(bytes));
          },
          close: async () => {},
          abort: async () => {},
        }),
      }),
    });
  });
  await page.getByRole('button', { name: 'Export MIDI', exact: true }).click();
  await expect(page.getByText('MIDI exported', { exact: true })).toBeVisible();
  await page.getByLabel('Analysis FFT size', { exact: true }).selectOption('8192');
  await page.getByRole('button', { name: 'Fit detected notes' }).click();
  await expect(page.getByText(/8192 FFT/)).toBeVisible();
  await page.getByRole('button', { name: 'Export MIDI', exact: true }).click();
  const outputs = await page.evaluate(
    () => (window as Window & { midiOutputs?: number[][] }).midiOutputs!,
  );
  expect(outputs).toHaveLength(2);
  expect(outputs[1]).toEqual(outputs[0]);
  const notes = parseMidi(new Uint8Array(outputs[0]));
  expect(notes.filter((e) => e.status === 0x90).map((e) => e.note)).toEqual([60, 64, 69]);
  const spectrum = (await page.locator('.spectral-pixels:visible').boundingBox())!;
  const low = noteHz(57),
    high = noteHz(72);
  await page.mouse.move(
    spectrum.x + spectrum.width * 0.8,
    spectrum.y + ((1 - Math.log(440 / low) / Math.log(high / low)) * spectrum.height) / 2,
  );
  await expect(page.getByLabel('Pitch at cursor')).toContainText('A4');
  await expect(page.getByLabel('Detected note details')).toContainText('MIDI 69');
  // Resizing keeps note controls within the workspace at the desktop minimum size.
  await page.setViewportSize({ width: 1000, height: 680 });
  const controls = (await page.getByLabel('Notes and MIDI', { exact: true }).boundingBox())!;
  expect(controls.x).toBeGreaterThanOrEqual(0);
  expect(controls.x + controls.width).toBeLessThanOrEqual(1000);
  await page.setViewportSize({ width: 1480, height: 960 });
  for (const [label, value] of [
    ['Start', '0'],
    ['End', '2'],
    ['Low frequency', '0'],
    ['High frequency', '24000'],
  ]) {
    const input = page.getByRole('textbox', { name: label, exact: true });
    await input.fill(value);
    await input.press('Enter');
  }
  await page.getByRole('button', { name: '-120 dB', exact: true }).click();
  await page.getByRole('button', { name: 'Create gain layer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export MIDI', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await expect(page.getByText(/No stable notes found/)).toBeVisible();
  await page.getByRole('button', { name: 'Conversion settings', exact: true }).click();
  await page.getByLabel('Note conversion signal', { exact: true }).selectOption('original');
  await page.getByRole('button', { name: 'Close conversion settings', exact: true }).click();
  await page.getByRole('button', { name: 'Convert to notes', exact: true }).click();
  await expect(page.getByText('3 notes detected', { exact: true })).toBeVisible();
});
