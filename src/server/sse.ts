import { watch, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sep } from 'node:path';
import { home } from '../core/paths.js';

const DEBOUNCE_MS = 200;
const PING_MS = 25_000;
const ID_RE = /^[a-z0-9-]+$/;

export interface Sse {
  handle(req: IncomingMessage, res: ServerResponse): void;
  close(): void;
}

/** One recursive watcher on home(); emits {type:'project', id} per changed project, debounced per id. */
export function createSse(): Sse {
  const clients = new Set<ServerResponse>();
  const timers = new Map<string, NodeJS.Timeout>();
  let watcher: FSWatcher | null = null;
  let ping: NodeJS.Timeout | null = null;

  const emit = (id: string) => {
    const line = `data: ${JSON.stringify({ type: 'project', id })}\n\n`;
    for (const c of clients) c.write(line);
  };

  const onChange = (_event: string, name: string | Buffer | null) => {
    if (!name) return;
    const rel = name.toString();
    if (rel.includes('.part') || rel.includes('.tmp-')) return;
    const parts = rel.split(sep);
    if (parts[0] !== 'projects' || parts.length < 3 || !ID_RE.test(parts[1])) return;
    const id = parts[1];
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        emit(id);
      }, DEBOUNCE_MS),
    );
  };

  const start = () => {
    if (watcher) return;
    watcher = watch(home(), { recursive: true }, onChange);
    watcher.on('error', () => {});
    ping = setInterval(() => {
      for (const c of clients) c.write(': ping\n\n');
    }, PING_MS);
    ping.unref();
  };

  return {
    handle(req, res) {
      start();
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    close() {
      watcher?.close();
      watcher = null;
      if (ping) clearInterval(ping);
      ping = null;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const c of clients) c.end();
      clients.clear();
    },
  };
}
