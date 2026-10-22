#!/usr/bin/env node
/* Minimal static server for local testing.
 *
 * Service workers require a real HTTP origin, so `file://` will not do.
 * Usage: node dev-server.js  (PORT=8000 by default)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (error) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, path.normalize(pathname));

  // Never serve outside the project directory.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }

    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      // Dev server: always fetch fresh files, and allow the SW to update.
      'Cache-Control': 'no-store',
    };

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Grocery Planner → http://localhost:${PORT}/`);
  console.log('Service worker enabled. Open the URL on your phone via your LAN IP if needed.');
});
