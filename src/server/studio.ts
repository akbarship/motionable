import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadConfig } from '../core/config.js';
import { home } from '../core/paths.js';
import { readJson, writeJson } from '../core/store.js';
import { handleApi, send } from './routes.js';
import { createSse } from './sse.js';

const StudioInfoSchema = z.object({ port: z.number(), token: z.string(), pid: z.number() });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Walk up from this file to the package.json, then dist/studio. */
function staticRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (dir !== dirname(dir) && existsPkg(dir)) break;
    dir = dirname(dir);
  }
  return join(dir, 'dist', 'studio');
}
const existsPkg = (d: string) => existsSync(join(d, 'package.json'));

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const root = resolve(staticRoot());
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, { error: 'bad path' });
  }
  if (rel.includes('\0')) return send(res, 400, { error: 'bad path' });
  const file = resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
  if (file !== root && !file.startsWith(root + sep)) return send(res, 404, { error: 'not found' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

function tokenOk(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startStudio(
  opts: { port?: number; token?: string } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const token = opts.token ?? randomBytes(32).toString('hex');
  const port = opts.port ?? (await loadConfig()).port;
  await mkdir(home(), { recursive: true });
  const sse = createSse();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      const h = req.headers['x-motionable-token'];
      const given = url.searchParams.get('t') ?? (Array.isArray(h) ? h[0] : h);
      if (!tokenOk(given, token)) return send(res, 401, { error: 'unauthorized' });
      if (url.pathname === '/api/events' && req.method === 'GET') return sse.handle(req, res);
      void handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    void serveStatic(res, url.pathname);
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  const actual = (server.address() as AddressInfo).port;
  const info = join(home(), 'studio.json');
  await writeJson(info, StudioInfoSchema, { port: actual, token, pid: process.pid }, 0o600);

  return {
    url: `http://127.0.0.1:${actual}/?t=${token}`,
    async close() {
      sse.close();
      const closed = new Promise<void>((r) => server.close(() => r()));
      server.closeAllConnections();
      await closed;
      try {
        if ((await readJson(info, StudioInfoSchema)).pid === process.pid) await unlink(info);
      } catch {
        // already gone
      }
    },
  };
}
