import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, stat, unlink } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, extname, join } from 'node:path';
import { ZodError } from 'zod';
import { loadConfig, maskedConfig, saveConfig } from '../core/config.js';
import { assertId, home, projectDir, styleDir } from '../core/paths.js';
import { addTask, approve, fail, listTasks, retry as retryTask, stop as stopTask } from '../core/queue.js';
import { checkBotUrl, createBotProvider } from '../providers/bot.js';
import { prices } from '../providers/util.js';
import { quoteItems } from '../providers/registry.js';
import { KindSchema } from '../core/types.js';
import { ensurePreview } from './preview.js';
import { bindSession, createProject, getProject, listProjects, readJson, setLast, slugId, writeJson } from '../core/store.js';
import { ChatMsgSchema, CutSchema, PlanSchema, ProjectSchema, SessionIdSchema, StoryboardSchema, StyleAnswersSchema, StyleSchema, type ChatMsg, type Cut, type TaskType } from '../core/types.js';
import { RefDownloadError, RefUrlError, downloadRef, normalizeRefUrl } from '../media/ingest.js';
import { buildRefSheet } from '../media/refsheet.js';
import { HttpError, VIDEO_EXTS, checkFilename, handleUpload } from './upload.js';

const USER_TASK_TYPES: ReadonlySet<string> = new Set<TaskType>(['study_ref', 'roughcut', 'direct', 'storyboard', 'storyboard_edit', 'execute', 'render']);
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
    if (e instanceof SyntaxError || e instanceof ZodError) return 'invalid' as const; // torn or invalid plan.json
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
        fontFamily: s.type?.families[0] ?? s.captions.fontFamily,
        transitions: s.transitions,
        ...(s.background ? { background: s.background.notes ?? s.background.kind } : {}),
      });
    } catch {
      // bad id, missing or invalid style.json
    }
  }
  return out;
}

const stemOf = (name: string) => name.slice(0, name.length - extname(name).length);
const sheetDirOf = (name: string) => `refs/${stemOf(name)}.sheet`;

/** Builds the contact sheet for one stored ref. The ref waits ("qo'shildi") until the user starts the study. */
async function addRef(id: string, file: string) {
  const name = basename(file);
  await buildRefSheet(file, join(projectDir(id), sheetDirOf(name)));
  return { name, sheetDir: sheetDirOf(name) };
}

/** Ref video names inside a study_ref task input (`videos[]`, or the older single `video`). */
export function studyVideos(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(input.videos)) {
    for (const v of input.videos) {
      const p = (v as { video?: unknown } | null)?.video;
      if (typeof p === 'string') out.push(basename(p));
    }
  } else if (typeof input.video === 'string') out.push(basename(input.video));
  return out;
}

/** Stored ref videos (with a built sheet) and the newest study task that covers each. */
async function listRefs(id: string) {
  const dir = join(projectDir(id), 'refs');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const tasks = (await listTasks(id)).filter((t) => t.type === 'study_ref');
  const out: { name: string; size: number; taskId: string | null; status: string }[] = [];
  for (const name of names.sort()) {
    if (!VIDEO_EXTS.has(extname(name).toLowerCase())) continue;
    try {
      const st = await stat(join(dir, name));
      if (!st.isFile()) continue;
      await stat(join(projectDir(id), sheetDirOf(name), 'cuts.json'));
      const t = [...tasks].reverse().find((x) => studyVideos(x.input).includes(name));
      out.push({ name, size: st.size, taskId: t?.id ?? null, status: t?.status ?? 'added' });
    } catch {
      // no sheet yet (still building or failed) or vanished
    }
  }
  return out;
}

/** One study_ref task for every stored ref, so the agent writes one style from all of them. */
async function startStudy(id: string, projectName: string) {
  const tasks = await listTasks(id);
  if (tasks.some((t) => t.type === 'study_ref' && (t.status === 'queued' || t.status === 'running'))) {
    throw new HttpError(409, 'study_in_progress');
  }
  const refs = await listRefs(id);
  if (refs.length === 0) throw new HttpError(400, 'no_refs');
  const videos = refs.map((r) => ({ video: `refs/${r.name}`, sheetDir: sheetDirOf(r.name) }));
  return addTask(id, 'study_ref', { videos, styleId: slugId(refs.length === 1 ? stemOf(refs[0].name) : projectName) });
}

/** storyboard/board.json, or null when the storyboard is not built yet (or is torn). */
async function readBoard(id: string) {
  try {
    return await readJson(join(projectDir(id), 'storyboard', 'board.json'), StoryboardSchema);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError || e instanceof ZodError) return null;
    throw e;
  }
}

const STILL_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

async function serveStill(req: IncomingMessage, res: ServerResponse, id: string, rawName: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    throw new HttpError(400, 'malformed filename');
  }
  const name = checkFilename(decoded, false, new Set(Object.keys(STILL_TYPES)));
  const data = await readFile(join(projectDir(id), 'storyboard', name)); // ENOENT -> 404
  res.writeHead(200, { 'content-type': STILL_TYPES[extname(name).toLowerCase()], 'content-length': data.length, 'cache-control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : data);
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
  return serveFile(req, res, join(projectDir(id), 'renders', name), 'video/mp4');
}

/** Streams a media file with single-range support (video players seek with ranges). */
async function serveFile(req: IncomingMessage, res: ServerResponse, file: string, type: string): Promise<void> {
  const size = (await stat(file)).size; // ENOENT -> 404
  const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes', 'referrer-policy': 'no-referrer' };
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

/** The last CLI calls agents made for this project (activity.jsonl), newest last: proof of work. */
async function readActivity(id: string): Promise<{ t: string; cmd: string }[]> {
  try {
    const lines = (await readFile(join(projectDir(id), 'activity.jsonl'), 'utf8')).trim().split('\n').slice(-8);
    return lines.flatMap((l) => {
      try {
        const x = JSON.parse(l) as { t?: unknown; cmd?: unknown };
        return typeof x.t === 'string' && typeof x.cmd === 'string' ? [{ t: x.t, cmd: x.cmd }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** cut.json (rough cut), or null before the first cut. */
async function readCut(id: string): Promise<Cut | null> {
  try {
    return await readJson(join(projectDir(id), 'cut.json'), CutSchema);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError || e instanceof ZodError) return null;
    throw e;
  }
}

const FOOTAGE_EXTS: Record<string, 'video' | 'audio'> = { '.mp4': 'video', '.mov': 'video', '.m4v': 'video', '.webm': 'video', '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio' };

/** The user's footage and voiceovers in broll/ (the assembled body is not one of them). */
async function listFootage(id: string): Promise<{ name: string; size: number; kind: 'video' | 'audio' }[]> {
  const dir = join(projectDir(id), 'broll');
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: { name: string; size: number; kind: 'video' | 'audio' }[] = [];
  for (const name of names.sort()) {
    const kind = FOOTAGE_EXTS[extname(name).toLowerCase()];
    if (!kind || /^body\./.test(name)) continue;
    try {
      out.push({ name, size: (await stat(join(dir, name))).size, kind });
    } catch {
      // vanished
    }
  }
  return out;
}

/** The chat id the Studio tab got from studio_open (x-motionable-session), or undefined. */
function sessionOf(req: IncomingMessage): string | undefined {
  const h = req.headers['x-motionable-session'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && SessionIdSchema.safeParse(v).success ? v : undefined;
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const seg = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"

  if (seg[0] === 'projects') {
    if (seg.length === 1) {
      if (method === 'GET') return send(res, 200, await listProjects());
      if (method === 'POST') {
        const b = await readBody(req);
        const p = await createProject({
          name: str(b.name, 'name'),
          brief: typeof b.brief === 'string' ? b.brief : '',
          session: sessionOf(req),
        });
        return send(res, 200, p);
      }
    } else {
      const id = assertId(seg[1]);
      if (seg.length === 2 && method === 'GET') {
        const session = sessionOf(req);
        const project = session ? await bindSession(id, session) : await getProject(id);
        await setLast(id);
        const [tasks, planRead, chat, activity] = await Promise.all([listTasks(id), readPlan(id), readChat(id), readActivity(id)]);
        if (planRead === 'invalid') return send(res, 200, { project, tasks, plan: null, planError: 'invalid', chat, activity });
        return send(res, 200, { project, tasks, plan: planRead, chat, activity });
      }
      if (seg[2] === 'footage' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await listFootage(id));
      }
      if (seg[2] === 'cut' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await readCut(id));
      }
      if (seg[2] === 'cut' && seg[3] === 'approve' && seg.length === 4 && method === 'POST') {
        const cut = await readCut(id);
        if (!cut?.body) throw new HttpError(409, 'no_cut');
        const next = { ...cut, approved: true };
        await writeJson(join(projectDir(id), 'cut.json'), CutSchema, next);
        return send(res, 200, next);
      }
      if (seg[2] === 'body' && seg.length === 3 && (method === 'GET' || method === 'HEAD')) {
        const cut = await readCut(id);
        if (!cut?.body || !/^broll\/body\.(mp4|wav)$/.test(cut.body)) throw new HttpError(404, 'no_body');
        return serveFile(req, res, join(projectDir(id), cut.body), cut.body.endsWith('.wav') ? 'audio/wav' : 'video/mp4');
      }
      if (seg[2] === 'player' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await ensurePreview(id));
      }
      if (seg[2] === 'storyboard' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await readBoard(id));
      }
      if (seg[2] === 'storyboard' && seg.length === 4 && method === 'DELETE') {
        const name = checkFilename(decodeURIComponent(seg[3]), false, new Set(Object.keys(STILL_TYPES)));
        const board = await readBoard(id);
        if (!board || !board.scenes.some((x) => x.file === name)) throw new HttpError(404, 'still not found');
        await unlink(join(projectDir(id), 'storyboard', name)).catch(() => {});
        const next = { ...board, scenes: board.scenes.map((x) => (x.file === name ? { ...x, deleted: true } : x)), updatedAt: new Date().toISOString() };
        await writeJson(join(projectDir(id), 'storyboard', 'board.json'), StoryboardSchema, next);
        return send(res, 200, next);
      }
      if (seg[2] === 'storyboard' && seg.length === 4 && (method === 'GET' || method === 'HEAD')) {
        return serveStill(req, res, id, seg[3]);
      }
      if (seg[2] === 'style-answers' && seg.length === 3 && method === 'PUT') {
        const b = await readBody(req);
        const answers = StyleAnswersSchema.parse(b);
        const project = await getProject(id);
        const next = { ...project, styleAnswers: answers };
        await writeJson(join(projectDir(id), 'project.json'), ProjectSchema, next);
        return send(res, 200, next);
      }
      if (seg[2] === 'renders' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await listRenders(id));
      }
      if (seg[2] === 'renders' && seg.length === 4 && method === 'DELETE') {
        const name = checkFilename(decodeURIComponent(seg[3]), false);
        if (extname(name).toLowerCase() !== '.mp4') throw new HttpError(400, 'file type not allowed');
        await unlink(join(projectDir(id), 'renders', name)); // ENOENT -> 404
        return send(res, 200, { deleted: name });
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
        return send(res, 201, { ref: await addRef(id, file) });
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
        return send(res, 201, { ref: await addRef(id, file) });
      }
      if (seg[2] === 'refs' && seg.length === 3 && method === 'GET') {
        return send(res, 200, await listRefs(id));
      }
      if (seg[2] === 'refs' && seg[3] === 'study' && seg.length === 4 && method === 'POST') {
        const project = await getProject(id);
        return send(res, 201, { task: await startStudy(id, project.name) });
      }
      if (seg[2] === 'refs' && seg.length === 4 && method === 'DELETE' && seg[3] !== 'file' && seg[3] !== 'study') {
        await getProject(id);
        let decoded: string;
        try {
          decoded = decodeURIComponent(seg[3]);
        } catch {
          throw new HttpError(400, 'malformed filename');
        }
        const name = checkFilename(decoded, false, VIDEO_EXTS);
        const busy = (await listTasks(id)).some(
          (t) => t.type === 'study_ref' && (t.status === 'queued' || t.status === 'running') && studyVideos(t.input).includes(name),
        );
        if (busy) throw new HttpError(409, 'study_in_progress');
        await unlink(join(projectDir(id), 'refs', name)); // ENOENT -> 404
        await rm(join(projectDir(id), sheetDirOf(name)), { recursive: true, force: true });
        return send(res, 200, { ok: true });
      }
      if (seg[2] === 'tasks' && seg.length === 3 && method === 'POST') {
        await getProject(id);
        const b = await readBody(req);
        if (typeof b.type !== 'string' || !USER_TASK_TYPES.has(b.type)) throw new HttpError(400, 'task type not allowed');
        const input = b.input ?? {};
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          throw new HttpError(400, 'input must be an object');
        }
        if (b.type === 'execute' && (await listTasks(id)).some((t) => t.type === 'execute' && (t.status === 'queued' || t.status === 'running'))) {
          throw new HttpError(409, 'execute_in_progress');
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
      if (seg[2] === 'tasks' && (seg[4] === 'stop' || seg[4] === 'retry') && seg.length === 5 && method === 'POST') {
        const tid = assertId(seg[3]);
        const before = (await listTasks(id)).find((t) => t.id === tid);
        if (!before) throw new HttpError(404, 'task not found');
        if (seg[4] === 'stop' && !['queued', 'running', 'awaiting_approval'].includes(before.status)) throw new HttpError(409, 'not_active');
        if (seg[4] === 'retry' && before.status !== 'failed') throw new HttpError(409, 'not_failed');
        return send(res, 200, seg[4] === 'stop' ? await stopTask(id, tid) : await retryTask(id, tid));
      }
      if (seg[2] === 'tasks' && seg[4] === 'approve' && seg.length === 5 && method === 'POST') {
        const tid = assertId(seg[3]);
        await getProject(id);
        const before = (await listTasks(id)).find((t) => t.id === tid);
        if (!before) throw new HttpError(404, 'task not found');
        if (before.status !== 'awaiting_approval') throw new HttpError(409, 'not_awaiting_approval');
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
  } else if (seg[0] === 'prices' && seg.length === 1 && method === 'GET') {
    return send(res, 200, prices);
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
      // A tab opened by a chat asks about that chat only; an old tab of a closed chat shows "ulanmagan".
      const session = sessionOf(req);
      const file = session ? join(home(), 'heartbeats', session) : join(home(), 'heartbeat');
      connected = Date.now() - (await stat(file)).mtimeMs < HEARTBEAT_MAX_MS;
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
