import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

function fixture(name = 'Stereo reference.wav', offset = 0) {
  const rate = 48000,
    frames = rate * 3,
    channels = 2;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(0.5 * Math.sin((2 * Math.PI * 937.5 * i) / rate + offset) * 32767);
    buffer.writeInt16LE(v, 44 + i * 4);
    buffer.writeInt16LE(-v, 46 + i * 4);
  }
  return { name, mimeType: 'audio/wav', buffer };
}
async function openFixture(page: Page, file = fixture()) {
  await page.getByLabel('Import WAV').setInputFiles(file);
  await expect(page.getByText(file.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('SHA-256 verified', { exact: true })).toBeVisible();
  await expect(page.getByText(/2048 FFT/)).toBeVisible();
}
async function number(page: Page, label: string, value: string) {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(value);
  await input.press('Enter');
}
async function gainLayer(page: Page) {
  await number(page, 'Start', '0.5');
  await number(page, 'End', '1.5');
  await number(page, 'Low frequency', '750');
  await number(page, 'High frequency', '1200');
  await page.getByLabel('Target channels').selectOption('0');
  await page.getByRole('button', { name: '-6 dB', exact: true }).click();
  await page.getByRole('button', { name: 'Create gain layer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Delete Spectral attenuation/ })).toBeVisible();
  await expect(page.getByText('Processed spectrum', { exact: true })).toBeVisible();
}
async function exportWav(page: Page, bits = '64') {
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.getByRole('button', { name: 'Export audio', exact: true }).click();
  await page.getByLabel('Export precision').selectOption(bits);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  const download = await waiting;
  const path = await download.path();
  expect(path).toBeTruthy();
  return readFile(path!);
}

test('opens an honest empty workspace and real calibration analysis', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Every frequency/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export audio', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Explore a calibration session' }).click();
  await expect(page.getByText('SHA-256 verified', { exact: true })).toBeVisible();
  await expect(page.getByText(/2048 FFT/)).toBeVisible();
  const colorCount = await page.locator('.spectral-pixels:visible').evaluate((canvas) => {
    const c = canvas as HTMLCanvasElement;
    const gl = c.getContext('webgl2');
    let b: Uint8Array | Uint8ClampedArray;
    if (gl) {
      b = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, b);
    } else b = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < b.length; i += 64) colors.add(`${b[i]},${b[i + 1]},${b[i + 2]}`);
    return colors.size;
  });
  expect(colorCount).toBeGreaterThan(40);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/tonalia-workspace.png' });
});

test('imports and measures stereo without cancellation or downmix', async ({ page }) => {
  await page.goto('/');
  await openFixture(page);
  await expect(page.locator('.mini-stats').first()).toContainText('-1.000');
  await expect(page.locator('.mini-stats').first()).toContainText('-6.0 dBFS');
  await page.getByRole('tab', { name: 'Analyze', exact: true }).click();
  await expect(page.getByText('Left channel', { exact: true })).toBeVisible();
  await expect(page.getByText('Right channel', { exact: true })).toBeVisible();
  await expect(page.getByText('Sample peak and unweighted RMS.', { exact: false })).toBeVisible();
});

test('creates an actual reversible spectral edit, preserves the right channel and exports exact-rate audio', async ({
  page,
}) => {
  const file = fixture();
  const originalHash = createHash('sha256').update(file.buffer).digest('hex');
  await page.goto('/');
  await openFixture(page, file);
  await gainLayer(page);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Delete Spectral attenuation/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Delete Spectral attenuation/ })).toHaveCount(1);
  const output = await exportWav(page);
  expect(output.toString('ascii', 0, 4)).toBe('RIFF');
  expect(output.readUInt16LE(20)).toBe(3);
  expect(output.readUInt16LE(22)).toBe(2);
  expect(output.readUInt32LE(24)).toBe(48000);
  expect(output.readUInt16LE(34)).toBe(64);
  expect(output.length).toBe(44 + 144000 * 16);
  let inputPower = 0,
    outputPower = 0,
    rightError = 0,
    outsideError = 0;
  for (let i = 0; i < 144000; i++) {
    const left = file.buffer.readInt16LE(44 + i * 4) / 32768,
      right = file.buffer.readInt16LE(46 + i * 4) / 32768;
    const rendered = output.readDoubleLE(44 + i * 16);
    rightError = Math.max(rightError, Math.abs(output.readDoubleLE(52 + i * 16) - right));
    if (i < 20000 || i > 75000) outsideError = Math.max(outsideError, Math.abs(rendered - left));
    if (i > 35000 && i < 55000) {
      inputPower += left * left;
      outputPower += rendered * rendered;
    }
  }
  expect(rightError).toBe(0);
  expect(outsideError).toBe(0);
  expect(10 * Math.log10(outputPower / inputPower)).toBeCloseTo(-6, 2);
  expect(createHash('sha256').update(file.buffer).digest('hex')).toBe(originalHash);
});

test('display FFT, brightness and zoom do not reinterpret saved edits', async ({ page }) => {
  await page.goto('/');
  await openFixture(page);
  await gainLayer(page);
  const before = await exportWav(page, '32');
  await page.getByLabel('Analysis FFT size').selectOption('4096');
  await page.getByLabel('Frequency scale').selectOption('linear');
  await number(page, 'Display floor', '-140');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const after = await exportWav(page, '32');
  expect(after.equals(before)).toBe(true);
});

test('project save and relink verifies source identity before restoring layers', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page);
  await gainLayer(page);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save project/ }).click();
  const downloaded = await waiting;
  const manifest = await readFile((await downloaded.path())!);
  const saved = JSON.parse(manifest.toString());
  expect(saved.layers).toHaveLength(1);
  expect(saved.source.sha256).toBe(createHash('sha256').update(fixture().buffer).digest('hex'));
  await page.reload();
  await page.getByLabel('Import project').setInputFiles({
    name: 'session.tonalia.json',
    mimeType: 'application/json',
    buffer: manifest,
  });
  await expect(page.getByText(/Edits load only after/)).toBeVisible();
  await openFixture(page, fixture('Wrong source.wav', 0.5));
  await expect(page.getByRole('alert')).toContainText('does not match');
  await expect(page.getByRole('button', { name: /Delete Spectral attenuation/ })).toHaveCount(0);
  await openFixture(page);
  await expect(page.getByRole('button', { name: /Delete Spectral attenuation/ })).toHaveCount(1);
  await expect(page.getByText(/Edits load only after/)).toHaveCount(0);
});

test('invalid WAV is rejected without destroying the current source', async ({ page }) => {
  await page.goto('/');
  await openFixture(page);
  await page.getByLabel('Import WAV').setInputFiles({
    name: 'broken.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('invalid audio'),
  });
  await expect(page.getByRole('alert')).toContainText('WAV');
  await expect(page.getByText('Stereo reference.wav', { exact: true }).first()).toBeVisible();
  const out = await exportWav(page);
  expect(out.readDoubleLE(44 + 1000 * 16)).toBe(
    fixture().buffer.readInt16LE(44 + 1000 * 4) / 32768,
  );
});

test('playback uses a real AudioWorklet clock and can pause', async ({ page }) => {
  await page.goto('/');
  await openFixture(page);
  await page.getByRole('button', { name: 'Play audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await expect
    .poll(async () => page.locator('.time-display>span').innerText())
    .not.toBe('0:00.000');
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  const paused = await page.locator('.time-display>span').innerText();
  await page.waitForTimeout(300);
  expect(await page.locator('.time-display>span').innerText()).toBe(paused);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('brush and lasso produce persistent masks and GPU loss falls back without losing edits', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page);
  const viewport = page.getByLabel('Spectral audio canvas.', { exact: false });
  const rect = await viewport.boundingBox();
  expect(rect).toBeTruthy();
  await page.getByRole('button', { name: 'Spectral brush', exact: true }).click();
  await page.mouse.move(rect!.x + rect!.width * 0.38, rect!.y + rect!.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * 0.52, rect!.y + rect!.height * 0.5, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Create gain layer', exact: true }).click();
  await expect(page.getByRole('button', { name: /Delete Spectral attenuation/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Time feather', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Lasso selection', exact: true }).click();
  await page.mouse.move(rect!.x + rect!.width * 0.6, rect!.y + rect!.height * 0.37);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * 0.75, rect!.y + rect!.height * 0.4, { steps: 8 });
  await page.mouse.move(rect!.x + rect!.width * 0.68, rect!.y + rect!.height * 0.53, { steps: 8 });
  await page.mouse.move(rect!.x + rect!.width * 0.6, rect!.y + rect!.height * 0.37, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('textbox', { name: 'Layer name', exact: true }).fill('Lasso repair region');
  await page.getByRole('button', { name: 'Create gain layer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Lasso repair region' })).toBeVisible();
  await page.locator('.gpu-spectral').evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await expect(page.locator('.gpu-spectral')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Delete Lasso repair region' })).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('browser output picker refuses the source filename before writing', async ({ page }) => {
  await page.goto('/');
  await openFixture(page);
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => ({
        name: 'Stereo reference.wav',
        createWritable: async () => {
          throw new Error('The source writer must never be opened.');
        },
      }),
    });
  });
  await page.getByRole('button', { name: 'Export audio', exact: true }).click();
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('different filename');
  await expect(page.getByRole('alert')).not.toContainText('writer must');
});

test('keyboard commands protect typing and wheel/pinch zoom preserves audio', async ({ page }) => {
  await page.goto('/');
  await openFixture(page);
  const field = page.getByRole('textbox', { name: 'Layer name', exact: true });
  await field.fill('Typing B M L T stays in this field');
  await expect(field).toHaveValue('Typing B M L T stays in this field');
  await field.press('Tab');
  await page.locator('.brand').click();
  await page.keyboard.press('Control+a');
  await expect(page.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0.000');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('=');
  const before = await page.locator('.overview-window').getAttribute('style');
  const canvas = page.getByLabel('Spectral audio canvas.', { exact: false });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.wheel(0, -180);
  await expect.poll(() => page.locator('.overview-window').getAttribute('style')).not.toBe(before);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Control');
  await page.keyboard.press('0');
  const gesture = async (type: string, scale: number) =>
    canvas.evaluate(
      (el, args) => {
        const event = new Event(args.type, { cancelable: true });
        Object.assign(event, { scale: args.scale, clientX: el.getBoundingClientRect().left + 200 });
        el.dispatchEvent(event);
      },
      { type, scale },
    );
  await gesture('gesturestart', 1);
  await gesture('gesturechange', 2);
  const pinchBefore = await page.locator('.overview-window').getAttribute('style');
  await page.waitForTimeout(50);
  await gesture('gesturechange', 4);
  await expect
    .poll(() => page.locator('.overview-window').getAttribute('style'))
    .not.toBe(pinchBefore);
  await page.keyboard.press('0');
  const out = await exportWav(page);
  expect(out.readDoubleLE(44 + 1000 * 16)).toBe(
    fixture().buffer.readInt16LE(44 + 1000 * 4) / 32768,
  );
});

test('restoration is reversible, persists after recovery and preserves the unselected channel', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page);
  await number(page, 'Start', '0.5');
  await number(page, 'End', '1.5');
  await page.getByLabel('Target channels').selectOption('0');
  await page.getByRole('tab', { name: 'Restore', exact: true }).click();
  await page.getByLabel('Restoration operation').selectOption('spectralGate');
  await number(page, 'Gate threshold', '0');
  await number(page, 'Maximum reduction', '24');
  await page.getByRole('button', { name: 'Create restoration layer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Delete Spectral gate', exact: true }),
  ).toBeVisible();
  const output = await exportWav(page);
  const source = fixture().buffer;
  let energy = 0,
    original = 0,
    rightError = 0;
  for (let t = 0; t < 144000; t++) {
    rightError = Math.max(
      rightError,
      Math.abs(output.readDoubleLE(52 + t * 16) - source.readInt16LE(46 + t * 4) / 32768),
    );
    if (t > 35000 && t < 55000) {
      energy += output.readDoubleLE(44 + t * 16) ** 2;
      original += (source.readInt16LE(44 + t * 4) / 32768) ** 2;
    }
  }
  expect(rightError).toBe(0);
  expect(energy / original).toBeLessThan(0.1);
  await page.getByRole('button', { name: 'Bypass Spectral gate', exact: true }).click();
  const bypass = await exportWav(page);
  expect(bypass.readDoubleLE(44 + 40000 * 16)).toBe(source.readInt16LE(44 + 40000 * 4) / 32768);
  // The recovery store survives a full reload and still enforces source relinking.
  await page.waitForTimeout(1800);
  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Local version history' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await openFixture(page);
  await expect(
    page.getByRole('button', { name: 'Enable Spectral gate', exact: true }),
  ).toBeVisible();
});

test('offline neural speech model renders real audio without a network dependency', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await openFixture(page);
  await page.context().setOffline(true);
  await number(page, 'Start', '0.5');
  await number(page, 'End', '1.5');
  await page.getByLabel('Target channels').selectOption('0');
  await page.getByRole('tab', { name: 'Restore', exact: true }).click();
  await page.getByLabel('Restoration operation').selectOption('neuralSpeechV1');
  await page.getByRole('button', { name: 'Create restoration layer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Delete Neural speech denoise', exact: true }),
  ).toBeVisible();
  const out = await exportWav(page);
  const source = fixture().buffer;
  let difference = 0,
    rightError = 0,
    finite = true;
  for (let t = 0; t < 144000; t++) {
    const v = out.readDoubleLE(44 + t * 16);
    finite &&= Number.isFinite(v);
    rightError = Math.max(
      rightError,
      Math.abs(out.readDoubleLE(52 + t * 16) - source.readInt16LE(46 + t * 4) / 32768),
    );
    if (t > 30000 && t < 60000) difference += Math.abs(v - source.readInt16LE(44 + t * 4) / 32768);
  }
  expect(finite).toBe(true);
  expect(rightError).toBe(0);
  expect(difference).toBeGreaterThan(1);
});
