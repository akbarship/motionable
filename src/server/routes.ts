import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { loadConfig, maskedConfig, saveConfig } from '../core/config.js';
import { assertId, home, projectDir } from '../core/paths.js';
import { addTask, approve, listTasks } from '../core/queue.js';
import { createProject, getProject, listProjects, readJson, setLast } from '../core/store.js';
import { ChatMsgSchema, PlanSchema, type ChatMsg, type TaskType } from '../core/types.js';
import { HttpError, handleUpload } from './upload.js';

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

async function readPlan(id: string) {
  try {
    return await readJson(join(projectDir(id), 'plan.json'), PlanSchema);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
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
      if (seg[2] === 'upload' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const out = await handleUpload(req, id, url.searchParams.get('kind'));
        return send(res, 200, out);
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
      if (seg[2] === 'tasks' && seg[4] === 'approve' && seg.length === 5 && method === 'POST') {
        const tid = assertId(seg[3]);
        await getProject(id);
        await approve(id, tid);
        const task = (await listTasks(id)).find((t) => t.id === tid);
        if (!task) throw new HttpError(404, 'task not found');
        return send(res, 200, task);
      }
      if (seg[2] === 'chat' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        const text = str(b.text, 'text');
        const files = Array.isArray(b.files) ? b.files.filter((f): f is string => typeof f === 'string') : undefined;
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
  } else if (seg[0] === 'config' && seg.length === 1) {
    if (method === 'GET') return send(res, 200, maskedConfig(await loadConfig()));
    if (method === 'PUT') {
      const b = await readBody(req);
      return send(res, 200, maskedConfig(await saveConfig(b as Parameters<typeof saveConfig>[0])));
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
