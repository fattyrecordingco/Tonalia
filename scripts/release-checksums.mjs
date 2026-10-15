import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const expected = [
  'windows_x64_setup.exe',
  'macos_apple_silicon.dmg',
  'macos_intel.dmg',
  'linux_amd64.deb',
  'linux_x86_64.AppImage',
].map((s) => `Tonalia_${version}_${s}`);
const files = await readdir('release');
for (const name of expected)
  if (!files.includes(name)) throw new Error(`Missing installer: ${name}`);
for (const platform of ['windows', 'macos-arm64', 'macos-x64', 'linux']) {
  const report = JSON.parse(await readFile(`release/verification-${platform}.json`, 'utf8'));
  if (!report.passed || !report.installedPackage)
    throw new Error(`Installation check failed: ${platform}`);
}
await copyFile('docs/INSTALL.md', 'release/INSTALL.md');
const sum = [];
for (const file of (await readdir('release')).filter((n) => n !== 'SHA256SUMS.txt').sort()) {
  const hash = createHash('sha256')
    .update(await readFile(`release/${file}`))
    .digest('hex');
  sum.push(`${hash}  ${file}`);
}
await writeFile('release/SHA256SUMS.txt', sum.join('\n') + '\n');
console.log(sum.join('\n'));
