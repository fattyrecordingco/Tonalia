import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('downloads are the actual published installers and local links/images resolve', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See your sound.');
  const metadata = JSON.parse(await readFile('docs/implementation/build-artifacts.json', 'utf8'));
  for (const asset of metadata.artifacts) {
    const links = page.locator(`a[href="${asset.url}"]`);
    expect(await links.count()).toBeGreaterThan(0);
  }
  const targetUrls = new Set<string>();
  for (const path of ['./', 'guide/']) {
    await page.goto(path);
    const urls = await page
      .locator('a[href], img[src], script[src], link[rel="stylesheet"]')
      .evaluateAll((elements) =>
        elements.map((el) =>
          el instanceof HTMLAnchorElement
            ? el.href
            : el instanceof HTMLImageElement || el instanceof HTMLScriptElement
              ? el.src
              : (el as HTMLLinkElement).href,
        ),
      );
    for (const url of urls) {
      const parsed = new URL(url);
      if (parsed.origin !== 'http://127.0.0.1:1430') continue;
      if (parsed.hash) {
        const response = await request.get(parsed.pathname);
        expect(response.ok(), parsed.pathname).toBe(true);
        const body = await response.text();
        expect(body, `missing ${parsed.hash} in ${parsed.pathname}`).toContain(
          `id="${parsed.hash.slice(1)}"`,
        );
      }
      targetUrls.add(parsed.origin + parsed.pathname);
    }
  }
  for (const url of targetUrls) expect((await request.get(url)).ok(), url).toBe(true);
  expect(errors).toEqual([]);
});

test('OS instructions work by deep link and keyboard, and commands can be copied', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('guide/#install-mac');
  await expect(page.getByRole('tab', { name: 'Mac', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tabpanel', { name: 'Mac', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Mac', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Linux', exact: true })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'Linux', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy command', exact: true }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'sudo apt install ./Tonalia_0.4.2_linux_amd64.deb',
  );
  await expect(page.getByRole('status').filter({ hasText: 'Command copied.' })).toHaveCount(1);
});

test('guide search finds the right topic, clears correctly and handles no results', async ({
  page,
}) => {
  await page.goto('guide/');
  const search = page.getByRole('searchbox', { name: 'Find a topic' });
  await search.fill('48 kHz');
  await expect(page.locator('#restoration')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  await search.fill('separation');
  await expect(page.locator('#separation')).toBeVisible();
  await expect(page.locator('#separation')).toContainText('installed desktop app');
  await search.fill('Removed');
  await expect(page.locator('#save-export')).toBeVisible();
  await search.fill('unfindable-topic-93812');
  await expect(page.getByText('No matching topic.', { exact: false })).toBeVisible();
  await search.fill('');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Keys, mouse and trackpad', exact: true }).click();
  await expect(page).toHaveURL(/#shortcuts$/);
});

test('packaged browser path loads the engine and plays and exports the Removed signal', async ({
  page,
}) => {
  await page.goto('app/');
  await page.getByRole('button', { name: 'Explore a calibration session' }).click();
  await page.getByText('SHA-256 verified', { exact: true }).waitFor();
  await page.getByText(/2048 FFT/).waitFor();
  await page.getByRole('button', { name: 'Removed', exact: true }).click();
  await page.getByRole('button', { name: 'Play audio', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.time-display>span')?.textContent !== '0:00.000',
  );
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.evaluate(() =>
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }),
  );
  await page.getByRole('button', { name: 'Export audio', exact: true }).click();
  await expect(page.getByLabel('Export signal', { exact: true })).toHaveValue('removed');
  await page.getByLabel('Export precision').selectOption('64');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  const downloadPath = await (await waiting).path();
  expect(downloadPath).not.toBeNull();
  const wav = await readFile(downloadPath!);
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
  expect(wav.readUInt32LE(24)).toBe(48000);
  expect(wav.subarray(44).every((byte) => byte === 0)).toBe(true);
});

test('screenshots open in an accessible dialog and Escape returns focus', async ({ page }) => {
  await page.goto('./');
  const button = page.getByRole('button', { name: /Enlarge screenshot: Tonalia showing/ });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Screenshot viewer' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img[src]')).toHaveJSProperty('naturalWidth', 1600);
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(dialog.getByRole('link', { name: 'Open original image' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test('home and guide remain readable at phone and tablet sizes', async ({ page }) => {
  for (const width of [360, 768, 1480]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['./', 'guide/']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${path} overflows at ${width}`).toBe(false);
      await expect(page.getByRole('link', { name: 'Open editor', exact: true })).toBeVisible();
      const broken = await page
        .locator('img[src]')
        .evaluateAll((images) =>
          images.some(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth === 0,
          ),
        );
      expect(broken).toBe(false);
    }
  }
});

test('downloads and all installation instructions are readable without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:1430/Tonalia/');
    await expect(
      page.getByRole('link', { name: 'Download for Windows', exact: true }),
    ).toBeVisible();
    await page.goto('http://127.0.0.1:1430/Tonalia/guide/');
    for (const id of ['install-windows', 'install-mac', 'install-linux'])
      await expect(page.locator(`#${id}`)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('print view includes every OS and search-hidden section', async ({ page }) => {
  await page.goto('guide/');
  await page.getByRole('searchbox', { name: 'Find a topic' }).fill('neural');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
  for (const id of ['install-windows', 'install-mac', 'install-linux', 'workspace', 'save-export'])
    await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator('.guide-sidebar')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
