import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, join } from 'node:path';
import { ZodError } from 'zod';
import { loadConfig, maskedConfig, saveConfig } from '../core/config.js';
import { assertId, home, projectDir, styleDir } from '../core/paths.js';
import { addTask, approve, fail, listTasks } from '../core/queue.js';
import { checkBotUrl, createBotProvider } from '../providers/bot.js';
import { quoteItems } from '../providers/registry.js';
import { KindSchema } from '../core/types.js';
import { createProject, getProject, listProjects, readJson, setLast, slugId } from '../core/store.js';
import { ChatMsgSchema, PlanSchema, StyleSchema, type ChatMsg, type TaskType } from '../core/types.js';
import { RefDownloadError, RefUrlError, downloadRef, normalizeRefUrl } from '../media/ingest.js';
import { buildRefSheet } from '../media/refsheet.js';
import { ensurePreview } from './preview.js';
import { HttpError, checkFilename, handleUpload } from './upload.js';

const USER_TASK_TYPES: ReadonlySet<string> = new Set<TaskType>(['study_ref', 'direct', 'execute', 'render']);
const HEARTBEAT_MAX_MS = 300_000;
const BODY_MAX = 1024 * 1024;

export function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > BODY_MAX) throw new HttpError(413, 'body too large');
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  let v: unknown;
  try {
    v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'body must be an object');
  return v as Record<string, unknown>;
}

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v.length === 0) throw new HttpError(400, `${what} must be a non-empty string`);
  return v;
};

async function readChat(id: string): Promise<ChatMsg[]> {
  let raw: string;
  try {
    raw = await readFile(join(projectDir(id), 'chat.jsonl'), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: ChatMsg[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(ChatMsgSchema.parse(JSON.parse(line)));
    } catch {
      // skip a torn or invalid line
    }
  }
  return out;
}

async function findAsset(id: string, name: string): Promise<string | null> {
  for (const kind of ['broll', 'refs']) {
    try {
      if ((await stat(join(projectDir(id), kind, name))).isFile()) return `${kind}/${name}`;
    } catch {
      // try next dir
    }
  }
  return null;
}

async function readPlan(id: string) {
  try {
    return await readJson(join(projectDir(id), 'plan.json'), PlanSchema);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** Short summaries of saved styles for the picker; unreadable or invalid ones are skipped. */
async function listStyles() {
  let ids: string[];
  try {
    ids = await readdir(join(home(), 'styles'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const id of ids.sort()) {
    try {
      const s = await readJson(join(styleDir(id), 'style.json'), StyleSchema);
      out.push({
        id,
        framing: s.framing,
        pace: s.pace,
        palette: s.colour.palette,
        fontFamily: s.captions.fontFamily,
        transitions: s.transitions,
      });
    } catch {
      // bad id, missing or invalid style.json
    }
  }
  return out;
}

async function studyRef(id: string, file: string) {
  const name = basename(file);
  const stem = name.slice(0, name.length - extname(name).length);
  const sheetDir = `refs/${stem}.sheet`;
  await buildRefSheet(file, join(projectDir(id), sheetDir));
  return addTask(id, 'study_ref', { video: `refs/${name}`, sheetDir, styleId: slugId(stem) });
}

async function listRenders(id: string) {
  const dir = join(projectDir(id), 'renders');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: { name: string; size: number; mtime: string; ms: number }[] = [];
  for (const name of names) {
    if (extname(name).toLowerCase() !== '.mp4') continue;
    try {
      const st = await stat(join(dir, name));
      if (st.isFile()) out.push({ name, size: st.size, mtime: st.mtime.toISOString(), ms: st.mtimeMs });
    } catch {
      // vanished
    }
  }
  return out.sort((a, b) => b.ms - a.ms).map(({ ms: _ms, ...r }) => r);
}

/** Streams an mp4 from renders/ with single-range support. */
async function serveRender(req: IncomingMessage, res: ServerResponse, id: string, rawName: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    throw new HttpError(400, 'malformed filename');
  }
  const name = checkFilename(decoded, false);
  if (extname(name).toLowerCase() !== '.mp4') throw new HttpError(400, 'file type not allowed');
  const file = join(projectDir(id), 'renders', name);
  const size = (await stat(file)).size; // ENOENT -> 404
  const headers: Record<string, string | number> = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' };
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const bad = () => {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
    };
    if (!m || (m[1] === '' && m[2] === '')) return bad();
    if (m[1] === '') {
      const n = Number(m[2]);
      if (n === 0 || size === 0) return bad();
      start = Math.max(0, size - n);
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
      if (start >= size || start > end) return bad();
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) return void res.end();
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const seg = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"

  if (seg[0] === 'projects') {
    if (seg.length === 1) {
      if (method === 'GET') return send(res, 200, await listProjects());
      if (method === 'POST') {
        const b = await readBody(req);
        const p = await createProject({ name: str(b.name, 'name'), brief: typeof b.brief === 'string' ? b.brief : '' });
        return send(res, 200, p);
      }
    } else {
      const id = assertId(seg[1]);
      if (seg.length === 2 && method === 'GET') {
        const project = await getProject(id);
        await setLast(id);
        const [tasks, plan, chat] = await Promise.all([listTasks(id), readPlan(id), readChat(id)]);
        return send(res, 200, { project, tasks, plan, chat });
      }
      if (seg[2] === 'preview' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await ensurePreview(id));
      }
      if (seg[2] === 'renders' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await listRenders(id));
      }
      if (seg[2] === 'renders' && seg.length === 4 && (method === 'GET' || method === 'HEAD')) {
        return serveRender(req, res, id, seg[3]);
      }
      if (seg[2] === 'upload' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const out = await handleUpload(req, id, url.searchParams.get('kind'));
        return send(res, 200, out);
      }
      if (seg[2] === 'refs' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        let file: string;
        try {
          file = await downloadRef(id, normalizeRefUrl(str(b.url, 'url')));
        } catch (e) {
          if (e instanceof RefUrlError) throw new HttpError(400, e.message);
          if (e instanceof RefDownloadError) throw new HttpError(502, e.message);
          throw e;
        }
        return send(res, 201, { task: await studyRef(id, file) });
      }
      if (seg[2] === 'refs' && seg[3] === 'file' && seg.length === 4 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        const name = checkFilename(str(b.name, 'name'), false);
        const file = join(projectDir(id), 'refs', name);
        try {
          if (!(await stat(file)).isFile()) throw new HttpError(404, 'not found');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, 'not found');
          throw e;
        }
        return send(res, 201, { task: await studyRef(id, file) });
      }
      if (seg[2] === 'tasks' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        if (typeof b.type !== 'string' || !USER_TASK_TYPES.has(b.type)) throw new HttpError(400, 'task type not allowed');
        const input = b.input ?? {};
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          throw new HttpError(400, 'input must be an object');
        }
        return send(res, 200, await addTask(id, b.type as TaskType, input as Record<string, unknown>));
      }
      if (seg[2] === 'quote' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        if (!Array.isArray(b.items)) throw new HttpError(400, 'items must be an array');
        const items = b.items.map((it) => {
          const o = (it ?? {}) as Record<string, unknown>;
          const kind = KindSchema.safeParse(o.kind);
          if (!kind.success) throw new HttpError(400, 'invalid kind');
          const params = o.params ?? {};
          if (typeof params !== 'object' || params === null || Array.isArray(params)) {
            throw new HttpError(400, 'params must be an object');
          }
          return { kind: kind.data, params: params as Record<string, unknown> };
        });
        return send(res, 200, await quoteItems(items, await loadConfig(), join(projectDir(id), 'gen')));
      }
      if (seg[2] === 'tasks' && seg[4] === 'approve' && seg.length === 5 && method === 'POST') {
        const tid = assertId(seg[3]);
        await getProject(id);
        await approve(id, tid);
        const task = (await listTasks(id)).find((t) => t.id === tid);
        if (!task) throw new HttpError(404, 'task not found');
        return send(res, 200, task);
      }
      if (seg[2] === 'tasks' && seg[4] === 'decline' && seg.length === 5 && method === 'POST') {
        const tid = assertId(seg[3]);
        await getProject(id);
        const task = (await listTasks(id)).find((t) => t.id === tid);
        if (!task) throw new HttpError(404, 'task not found');
        if (task.type !== 'generate' || task.status !== 'awaiting_approval') throw new HttpError(400, 'task not awaiting approval');
        await fail(id, tid, 'declined');
        const after = (await listTasks(id)).find((t) => t.id === tid);
        if (!after) throw new HttpError(404, 'task not found');
        return send(res, 200, after);
      }
      if (seg[2] === 'chat' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        const text = str(b.text, 'text');
        let files: string[] | undefined;
        if (b.files !== undefined) {
          if (!Array.isArray(b.files)) throw new HttpError(400, 'files must be an array');
          files = [];
          for (const f of b.files) {
            if (typeof f !== 'string') throw new HttpError(400, 'files must be strings');
            const name = checkFilename(f, false);
            const rel = await findAsset(id, name);
            if (!rel) throw new HttpError(400, `file not found: ${name}`);
            files.push(rel);
          }
        }
        const msg = ChatMsgSchema.parse({
          id: `m-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
          role: 'user',
          text,
          ...(files ? { files } : {}),
          at: new Date().toISOString(),
        });
        await mkdir(projectDir(id), { recursive: true });
        await appendFile(join(projectDir(id), 'chat.jsonl'), JSON.stringify(msg) + '\n');
        const task = await addTask(id, 'edit', { msgId: msg.id, text, files: files ?? [] });
        return send(res, 200, { msg, task });
      }
    }
  } else if (seg[0] === 'styles' && seg.length === 1 && method === 'GET') {
    return send(res, 200, await listStyles());
  } else if (seg[0] === 'config' && seg.length === 1) {
    if (method === 'GET') return send(res, 200, maskedConfig(await loadConfig()));
    if (method === 'PUT') {
      const b = await readBody(req);
      return send(res, 200, maskedConfig(await saveConfig(b as Parameters<typeof saveConfig>[0])));
    }
  } else if (seg[0] === 'bot' && seg[1] === 'balance' && seg.length === 2 && method === 'GET') {
    const cfg = await loadConfig();
    if (!cfg.botKey) throw new HttpError(400, 'no_bot_key');
    if (!checkBotUrl(cfg.botUrl)) throw new HttpError(400, 'bad_bot_url');
    try {
      return send(res, 200, await createBotProvider({ botKey: cfg.botKey, botUrl: cfg.botUrl }).balance());
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  } else if (seg[0] === 'claude' && seg.length === 1 && method === 'GET') {
    let connected = false;
    try {
      connected = Date.now() - (await stat(join(home(), 'heartbeat'))).mtimeMs < HEARTBEAT_MAX_MS;
    } catch {
      // no heartbeat file
    }
    return send(res, 200, { connected });
  }
  throw new HttpError(404, 'not found');
}

/** Runs a route and maps errors to JSON responses. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  try {
    await route(req, res, url);
  } catch (e) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const err = e as NodeJS.ErrnoException;
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    if (typeof err.message === 'string' && err.message.startsWith('invalid id')) return send(res, 400, { error: err.message });
    if (err.code === 'ENOENT') return send(res, 404, { error: 'not found' });
    if (e instanceof ZodError) return send(res, 400, { error: 'invalid data' });
    send(res, 500, { error: 'internal error' });
  }
}
