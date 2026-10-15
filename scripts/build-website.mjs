import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const base = process.env.TONALIA_SITE_BASE || '/Tonalia/';
if (!/^\/[A-Za-z0-9/_-]*\/$/.test(base))
  throw new Error('Site base must be a URL path with a trailing slash.');
if (!process.argv.includes('--reuse-app')) {
  const win = process.platform === 'win32';
  const npmCli =
    process.env.npm_execpath ||
    (win ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null);
  const result = spawnSync(
    npmCli ? process.execPath : 'npm',
    npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, TONALIA_PUBLIC_BASE: `${base}app/` },
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
const app = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (!app.includes(`${base}app/assets/`))
  throw new Error(`Build the editor with TONALIA_PUBLIC_BASE=${base}app/ before packaging.`);
const out = new URL('../site-dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(new URL('../website/', import.meta.url), out, { recursive: true });
await cp(new URL('../dist/', import.meta.url), new URL('app/', out), { recursive: true });
await writeFile(new URL('.nojekyll', out), '');
const metadata = JSON.parse(
  await readFile(new URL('../docs/implementation/build-artifacts.json', import.meta.url), 'utf8'),
);
await writeFile(
  new URL('release.json', out),
  JSON.stringify(
    { version: metadata.version, release: metadata.release, downloads: metadata.artifacts },
    null,
    2,
  ) + '\n',
);
console.log(`Website and working browser editor packaged at site-dist, served under ${base}`);
