import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('site-dist');
const port = Number(process.env.TONALIA_SITE_PORT || 1430);
const base = '/Tonalia/';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') {
      res.writeHead(302, { Location: base });
      res.end();
      return;
    }
    if (!pathname.startsWith(base)) throw new Error('Wrong base');
    let target = resolve(root, pathname.slice(base.length));
    if (target !== root && !target.startsWith(root + sep)) throw new Error('Invalid path');
    if ((await stat(target)).isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' });
        res.end();
        return;
      }
      target = resolve(target, 'index.html');
    }
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': types[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Tonalia website: http://127.0.0.1:${port}${base}`));
