import { spawn, execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, mkdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Installs the actual distributable on an ephemeral CI runner, then starts its installed
// binary. The frontend's opt-in report proves React, worker, WASM, analysis and editing.
const platform = process.argv[2];
const temp = await mkdtemp(join(tmpdir(), 'tonalia-install-'));
await mkdir('release', { recursive: true });
const installers = await readdir('release');
let executable, args, child, mounted;
const reportPath = join(temp, 'installation.json');
const run = (program, values) => execFileSync(program, values, { stdio: 'inherit' });
try {
  if (platform === 'windows') {
    const installer = resolve(
      'release',
      installers.find((n) => n.endsWith('.exe')),
    );
    run(installer, ['/S']);
    executable = join(process.env.LOCALAPPDATA, 'Tonalia', 'tonalia-desktop.exe');
    args = ['--installation-check', reportPath];
  } else if (platform.startsWith('macos')) {
    mounted = join(temp, 'volume');
    await mkdir(mounted);
    run('hdiutil', [
      'attach',
      resolve(
        'release',
        installers.find((n) => n.endsWith('.dmg')),
      ),
      '-mountpoint',
      mounted,
      '-nobrowse',
      '-quiet',
    ]);
    run('ditto', [join(mounted, 'Tonalia.app'), '/Applications/Tonalia.app']);
    executable = '/usr/bin/sandbox-exec';
    args = [
      '-p',
      '(version 1) (allow default) (deny network-outbound (remote ip "*:*"))',
      '/Applications/Tonalia.app/Contents/MacOS/tonalia-desktop',
      '--installation-check',
      reportPath,
    ];
  } else if (platform === 'linux') {
    run('sudo', [
      'dpkg',
      '-i',
      resolve(
        'release',
        installers.find((n) => n.endsWith('.deb')),
      ),
    ]);
    executable = 'sudo';
    // A new network namespace has no internet interfaces. Xvfb/IPC use local sockets.
    args = [
      'unshare',
      '--net',
      '--',
      'runuser',
      '-u',
      process.env.USER,
      '--',
      'env',
      `DISPLAY=${process.env.DISPLAY}`,
      `XAUTHORITY=${process.env.XAUTHORITY || ''}`,
      'WEBKIT_DISABLE_DMABUF_RENDERER=1',
      'dbus-run-session',
      '--',
      '/usr/bin/tonalia-desktop',
      '--installation-check',
      reportPath,
    ];
  } else throw new Error('Unknown installation-check platform.');
  child = spawn(executable, args, { stdio: 'inherit' });
  let report;
  for (let i = 0; i < 120; i++) {
    try {
      report = JSON.parse(await readFile(reportPath, 'utf8'));
      break;
    } catch {}
    if (child.exitCode !== null)
      throw new Error(`Installed application exited early: ${child.exitCode}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  assert(report, 'Installed application did not report a loaded frontend and audio engine.');
  assert.equal(report.passed, true, JSON.stringify(report));
  report.platform = platform;
  report.installedPackage = true;
  report.networkIsolation =
    platform === 'linux'
      ? 'unshare network namespace'
      : platform.startsWith('macos')
        ? 'sandbox-exec outbound IP denial'
        : 'Offline browser/installed-app check is run separately on the Windows owner machine.';
  const output = `release/verification-${platform}.json`;
  await copyFile(reportPath, output);
  // Include the harness provenance alongside the diagnostic's numerical measurements.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child) {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    } else {
      child.kill('SIGTERM');
      // sandbox/runuser launchers may have spawned a separate child process.
      try {
        execFileSync('pkill', ['-f', 'tonalia-desktop --installation-check'], { stdio: 'ignore' });
      } catch {}
    }
  }
  if (mounted) {
    try {
      run('hdiutil', ['detach', mounted, '-quiet']);
    } catch {}
  }
  await rm(temp, { recursive: true, force: true }).catch(() => {});
}
