import { readFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
const [platform, target] = process.argv.slice(2);
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = process.env.RELEASE_TAG || `v${version}`;
if (tag !== `v${version}`) throw new Error('Release tag and package version differ.');
const directory = join('target', target, 'release', 'bundle');
const formats =
  platform === 'windows'
    ? [['nsis', '.exe', 'windows_x64_setup.exe']]
    : platform === 'macos-arm64'
      ? [['dmg', '.dmg', 'macos_apple_silicon.dmg']]
      : platform === 'macos-x64'
        ? [['dmg', '.dmg', 'macos_intel.dmg']]
        : platform === 'linux'
          ? [
              ['deb', '.deb', 'linux_amd64.deb'],
              ['appimage', '.AppImage', 'linux_x86_64.AppImage'],
            ]
          : [];
if (!formats.length) throw new Error('Unknown release platform.');
await mkdir('release', { recursive: true });
for (const [folder, extension, suffix] of formats) {
  const files = (await readdir(join(directory, folder))).filter((n) => n.endsWith(extension));
  if (files.length !== 1)
    throw new Error(`Expected one ${extension} package, found ${files.length}.`);
  const destination = join('release', `Tonalia_${version}_${suffix}`);
  await copyFile(join(directory, folder, files[0]), destination);
  console.log(destination);
}
