import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const directory = 'website/assets/screenshots';
await mkdir(directory, { recursive: true });
const shot = async (name) => {
  await page.getByText(/2048 FFT/).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${directory}/${name}.png` });
};
const number = async (label, value) => {
  const field = page.getByRole('textbox', { name: label, exact: true });
  await field.fill(value);
  await field.press('Enter');
};
try {
  await page.goto(process.env.TONALIA_SCREENSHOT_URL || 'http://127.0.0.1:1421/');
  await page.getByRole('button', { name: 'Explore a calibration session' }).click();
  await page.getByText('SHA-256 verified', { exact: true }).waitFor();
  await shot('workspace');
  await number('Start', '6');
  await number('End', '7');
  await number('Low frequency', '2500');
  await number('High frequency', '4000');
  await page
    .getByRole('textbox', { name: 'Layer name', exact: true })
    .fill('Turn down the whistle');
  await shot('selection');
  await page.getByRole('button', { name: 'Create gain layer', exact: true }).click();
  await shot('layers');
  await page.getByRole('tab', { name: 'Restore', exact: true }).click();
  await page.getByLabel('Restoration operation').selectOption('neuralSpeechV1');
  await shot('restore');
  await page.getByRole('tab', { name: 'Analyze', exact: true }).click();
  await shot('analyze');
  await page.getByRole('button', { name: 'Export audio', exact: true }).click();
  await shot('export');
  await page.getByRole('button', { name: 'Close export', exact: true }).click();
  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  await shot('shortcuts');
  await page.getByRole('button', { name: 'Close shortcuts', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await shot('history');
  await page.getByRole('button', { name: 'Close history', exact: true }).click();
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Delete Turn down the whistle', exact: true }).click();
  await page.getByRole('button', { name: 'Fit frequency range', exact: true }).click();
  await page.getByLabel('Frequency scale', { exact: true }).selectOption('linear');
  await number('View low frequency', '2000');
  await number('View high frequency', '4500');
  await number('Start', '6.2');
  await number('End', '7.8');
  await number('Low frequency', '2700');
  await number('High frequency', '3350');
  await page.getByRole('button', { name: 'Spectral brush', exact: true }).click();
  await page.getByLabel('Brush diameter', { exact: true }).fill('42');
  await page.getByLabel('Brush hardness', { exact: true }).fill('0.65');
  const box = await page.locator('.spectral-viewport').boundingBox();
  const xy = (time, hz) => ({
    x: box.x + 52 + (time / 18) * (box.width - 68),
    y: box.y + 124 + ((4500 - hz) / 2500) * ((box.height - 152) / 2),
  });
  const stroke = async (start, end) => {
    const a = xy(start, 3000),
      b = xy(end, 3000);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 18 });
    await page.mouse.up();
  };
  await stroke(8.6, 9.1);
  await stroke(10, 10.6);
  await page.getByRole('button', { name: 'Selection eraser', exact: true }).click();
  await page.getByLabel('Eraser diameter', { exact: true }).fill('24');
  await page.getByLabel('Eraser hardness', { exact: true }).fill('1');
  await stroke(6.95, 7.05);
  await page.locator('.inspector-content').evaluate((el) => {
    el.scrollTop = 0;
  });
  await shot('combined-selection');
  console.log('Captured nine real Tonalia screens from the generated practice recording.');
} finally {
  await browser.close();
}
