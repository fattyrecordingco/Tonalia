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
  console.log('Captured eight real Tonalia screens from the generated practice recording.');
} finally {
  await browser.close();
}
