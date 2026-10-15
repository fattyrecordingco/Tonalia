import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'tonalia-two-peers-'));
const source = join(temp, 'shared-reference.wav');
const frames = 48000;
const wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(3000 * Math.sin(i * 0.1)), 44 + i * 2);
await writeFile(source, wav);
const owned = [];
async function peer(index) {
  const port = await new Promise((resolvePort) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolvePort(port));
    });
  });
  const child = spawn(
    process.env.TONALIA_TEST_EXECUTABLE || resolve('target/release/tonalia-desktop.exe'),
    [source],
    {
      stdio: 'ignore',
      env: {
        ...process.env,
        WEBVIEW2_USER_DATA_FOLDER: join(temp, `profile-${index}`),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --proxy-server=http://127.0.0.1:9 --proxy-bypass-list="*.localhost;localhost;127.0.0.1" --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE ipc.localhost, EXCLUDE tauri.localhost, EXCLUDE 127.0.0.1"`,
      },
    },
  );
  const entry = { child };
  owned.push(entry);
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  entry.browser = browser;
  let page;
  for (let i = 0; i < 100; i++) {
    page = browser
      .contexts()[0]
      .pages()
      .find((p) => /tauri\.localhost|tauri:\/\//.test(p.url()));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(page);
  await page.getByText('SHA-256 verified', { exact: true }).waitFor({ timeout: 30000 });
  page.on('dialog', (dialog) => dialog.accept());
  return page;
}
try {
  const host = await peer(1),
    guest = await peer(2);
  assert((await host.locator('.status-bar').innerText()).includes('Tonalia 0.2.0'));
  assert((await guest.locator('.status-bar').innerText()).includes('Tonalia 0.2.0'));
  await host.getByRole('tab', { name: 'Share', exact: true }).click();
  await host.getByRole('button', { name: 'Host session', exact: true }).click();
  await host.getByLabel('Session invite', { exact: true }).waitFor();
  const invite = await host.getByLabel('Session invite', { exact: true }).inputValue();
  await guest.getByRole('tab', { name: 'Share', exact: true }).click();
  await guest.getByLabel('Paste session invite', { exact: true }).fill(invite);
  await guest.getByRole('button', { name: 'Join session', exact: true }).click();
  await guest.getByText('Connected · revision 0', { exact: false }).waitFor();
  await host.getByRole('tab', { name: 'Edit', exact: true }).click();
  for (const [label, value] of [
    ['Start', '0.1'],
    ['End', '0.5'],
  ]) {
    const field = host.getByRole('textbox', { name: label, exact: true });
    await field.fill(value);
    await field.press('Enter');
  }
  await host.getByRole('button', { name: 'Create gain layer', exact: true }).click();
  await guest
    .getByRole('button', { name: 'Delete Spectral attenuation', exact: true })
    .waitFor({ timeout: 10000 });
  await guest.getByRole('button', { name: 'Bypass Spectral attenuation', exact: true }).click();
  await host
    .getByRole('button', { name: 'Enable Spectral attenuation', exact: true })
    .waitFor({ timeout: 10000 });
  assert(await host.getByRole('button', { name: 'Undo', exact: true }).isDisabled());
  assert(await guest.getByRole('button', { name: 'Undo', exact: true }).isDisabled());
  await host.getByRole('tab', { name: 'Share', exact: true }).click();
  await host.getByRole('button', { name: 'Leave session and stop host', exact: true }).click();
  await guest.getByText(/Cannot reach the session host/).waitFor({ timeout: 12000 });
  assert.equal(
    await guest.getByRole('button', { name: 'Delete Spectral attenuation', exact: true }).count(),
    1,
  );
  await guest.getByRole('button', { name: 'Leave session', exact: true }).click();
  const report = {
    version: '0.2.0',
    executable: (
      process.env.TONALIA_TEST_EXECUTABLE || resolve('target/release/tonalia-desktop.exe')
    ).replace(process.env.USERPROFILE, '%USERPROFILE%'),
    installedPackage: !!process.env.TONALIA_TEST_EXECUTABLE,
    date: new Date().toISOString(),
    passed: true,
    peers: 2,
    distinctWebViewProfiles: true,
    identicalLocalSource: true,
    hostEditReachedGuest: true,
    guestBypassReachedHost: true,
    sharedUndoDisabled: true,
    hostStopObservedByGuest: true,
    layersPreservedOnDisconnect: true,
    webViewInternetBlocked: true,
    scope: 'Two native app processes on loopback; cross-machine LAN remains unqualified.',
  };
  await mkdir('docs/implementation', { recursive: true });
  await writeFile(
    process.env.TONALIA_COLLAB_REPORT || 'docs/implementation/windows-0.2-two-peers.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const { browser, child } of owned) {
    await browser?.close().catch(() => {});
    child.kill();
  }
  await new Promise((r) => setTimeout(r, 500));
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
