import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

async function loadEnv() {
  try {
    const contents = await readFile(path.join(root, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    }
  } catch { /* .env is optional for the static preview. */ }
}

const routes = new Map([
  ['/api/status', './api/status.mjs'],
  ['/api/employees', './api/employees.mjs'],
  ['/api/dashboard', './api/dashboard.mjs'],
  ['/api/transactions', './api/transactions.mjs'],
  ['/api/decisions', './api/decisions.mjs'],
  ['/api/link-telegram', './api/link-telegram.mjs'],
  ['/api/retry-sync', './api/retry-sync.mjs'],
  ['/api/retry-notification', './api/retry-notification.mjs'],
  ['/api/telegram/webhook', './api/telegram/webhook.mjs'],
  ['/api/telegram/set-webhook', './api/telegram/set-webhook.mjs']
]);

function contentType(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' })[path.extname(file)] || 'application/octet-stream';
}

await loadEnv();
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (routes.has(url.pathname)) {
    try {
      req.query = Object.fromEntries(url.searchParams.entries());
      res.status = function (status) { this.statusCode = status; return this; };
      const module = await import(routes.get(url.pathname));
      await module.default(req, res);
      if (!res.writableEnded) res.end();
    } catch (error) {
      console.error(error);
      if (!res.writableEnded) { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: 'Local server error.' })); }
    }
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => console.log(`Friends Included is available at http://localhost:${port}`));
