import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { projectDir } from '../core/paths.js';
import { HttpError } from './upload.js';

const READY_TIMEOUT_MS = 60_000;
const URL_RE = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s'")\]]*/;

interface Entry {
  child: ChildProcess;
  ready: Promise<{ url: string }>;
  dead: boolean;
}
const entries = new Map<string, Entry>();

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

function killEntry(e: Entry): void {
  e.dead = true;
  const pid = e.child.pid;
  try {
    if (pid && process.platform !== 'win32') process.kill(-pid, 'SIGTERM'); // whole group (npx -> node)
    else e.child.kill();
  } catch {
    try {
      e.child.kill();
    } catch {
      // already gone
    }
  }
}

async function hasComp(id: string): Promise<boolean> {
  try {
    return (await stat(join(projectDir(id), 'comp', 'index.html'))).isFile();
  } catch {
    return false;
  }
}

async function start(id: string): Promise<Entry> {
  const cwd = join(projectDir(id), 'comp');
  const port = await freePort();
  const override = process.env.MOTIONABLE_HF_BIN;
  const cmd = override ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const args = [...(override ? [] : ['hyperframes']), 'preview', '--foreground', '--port', String(port)];
  // BROWSER=none keeps the CLI from opening a tab; the Studio embeds the URL itself.
  const child = spawn(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, BROWSER: 'none' },
  });
  const entry = {} as Entry;
  entry.child = child;
  entry.dead = false;
  entry.ready = new Promise<{ url: string }>((ok, fail) => {
    let buf = '';
    let settled = false;
    const finish = (err: HttpError | null, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        killEntry(entry);
        if (entries.get(id) === entry) entries.delete(id);
        fail(err);
      } else ok({ url: url! });
    };
    const timer = setTimeout(() => finish(new HttpError(504, 'preview_timeout')), READY_TIMEOUT_MS);
    const onData = (d: Buffer) => {
      buf = (buf + d.toString('utf8')).slice(-8192);
      const m = URL_RE.exec(buf);
      if (m) finish(null, m[0]);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', () => finish(new HttpError(502, 'preview_failed')));
    child.once('exit', () => {
      entry.dead = true;
      if (entries.get(id) === entry) entries.delete(id);
      finish(new HttpError(502, 'preview_failed'));
    });
  });
  entry.ready.catch(() => {}); // the caller handles it; avoid an unhandled rejection
  return entry;
}

/** Starts (or reuses) the HyperFrames preview server for a project's comp/ and returns its URL. */
export async function ensurePreview(projectId: string): Promise<{ url: string }> {
  if (!(await hasComp(projectId))) throw new HttpError(409, 'no_comp');
  let e = entries.get(projectId);
  if (!e || e.dead) {
    e = await start(projectId);
    entries.set(projectId, e);
  }
  return e.ready;
}

export async function stopAllPreviews(): Promise<void> {
  const all = [...entries.values()];
  entries.clear();
  for (const e of all) killEntry(e);
}

process.once('exit', () => {
  for (const e of entries.values()) killEntry(e);
});
