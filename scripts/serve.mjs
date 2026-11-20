#!/usr/bin/env node
// Tiny zero-dependency static server for local development.
// Serves www/ on http://localhost:8080 (localhost is a secure context, so Web Crypto and the
// service worker work). Sends the same security headers as _headers. Not for production use.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../www', import.meta.url)));
const PORT = Number(process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
    const file = resolve(join(ROOT, rel));
    if (!file.startsWith(ROOT + '/') || rel.startsWith('_headers')) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache'
    }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`BreachGuard dev server: http://localhost:${PORT}`));
