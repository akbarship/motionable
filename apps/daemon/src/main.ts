// The Motionable daemon: one local server for Claude Code (through the MCP shim) and the Studio page.
// HTTP API + Server-Sent Events for live updates; pages are rebuilt from the plan after every change.
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Fastify from 'fastify';
import type {Batch} from '@motionable/plan';
import {HOME, STATE, deleteLesson, loadComponents, loadLessons, saveLesson} from '@motionable/plan/store';
import {lessonsFor, type Lesson} from '@motionable/plan';
import {buildPage} from './build';
import {analyzeFree, createProject, readReport, transcribe} from './analyze';
import {applyOps, cutCandidates, listProjects, projectDir, projectState, srtOf, studioView, undoLast} from './projects';
import {listVideos} from './videos';
import {claudeCodeStatus, connectClaudeCode, publicSettings, saveSettings} from './settings';
import {normalizeLoudness} from '@motionable/engine';
import {scaffold} from '@motionable/plan/scaffold';
import type {ComponentManifest, Style} from '@motionable/plan';
import {look, type LookArgs} from './look';
import {deleteFile, listFiles, saveUpload} from './files';
import {claudeCommand, claudeStatus, notesPrompt, startClaude, stopClaude} from './claude';
import {guard} from './guard';
import {addReferences, listStyles, pendingRefs, saveStyle, styleDetail, stylesDir, writeComponent} from './styles';

const PORT = Number(process.env.MOTIONABLE_PORT ?? 4377);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const app = Fastify({logger: false, bodyLimit: 8 * 1024 * 1024});
guard(app); // requests from other sites are refused (see guard.ts)

// ---------- live events (SSE) ----------
const clients = new Set<NodeJS.WritableStream>();
const emit = (event: Record<string, unknown>) => {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(line);
};
app.get('/api/events', (req, reply) => {
  reply.raw.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive'});
  reply.raw.write(': hi\n\n');
  clients.add(reply.raw);
  req.raw.on('close', () => clients.delete(reply.raw));
});

// ---------- page builds: one at a time per project, the latest plan wins ----------
const building = new Map<string, Promise<unknown>>();
const queued = new Set<string>();
const rebuild = (id: string) => {
  if (building.has(id)) return void queued.add(id);
  const t = Date.now();
  const p = buildPage(projectDir(id))
    // only a page that changed makes the players reload (a note, a lesson, a hidden-nothing role change don't)
    .then((r) => emit({type: r.changed ? 'page' : 'page-same', project: id, version: r.version, ms: Date.now() - t}))
    .catch((e) => emit({type: 'error', project: id, message: String(e.message ?? e)}))
    .finally(() => {
      building.delete(id);
      if (queued.delete(id)) rebuild(id);
    });
  building.set(id, p);
};

const tasks = new Map<string, Promise<unknown>>(); // analysis tasks per project (see below)

// ---------- API ----------
app.get('/api/health', () => ({ok: true, pid: process.pid, home: HOME}));
app.get('/api/projects', () => listProjects());
app.get<{Params: {id: string}; Querystring: {since?: string}}>('/api/projects/:id/state', (req) =>
  projectState(req.params.id, Number(req.query.since ?? 0), tasks.has(req.params.id)));
app.post<{Params: {id: string}; Body: Batch}>('/api/projects/:id/ops', (req, reply) => {
  try {
    const r = applyOps(req.params.id, req.body);
    emit({type: 'plan', project: req.params.id, version: r.version, by: req.body.by?.kind});
    rebuild(req.params.id);
    return r;
  } catch (e) {
    return reply.code(400).send({error: String((e as Error).message)});
  }
});
// the Studio's full view (never sent to Claude: get_project_state stays a diff)
app.get<{Params: {id: string}}>('/api/projects/:id/view', (req, reply) => {
  try {
    return studioView(req.params.id);
  } catch (e) {
    return reply.code(400).send({error: String((e as Error).message)});
  }
});
app.post<{Params: {id: string}}>('/api/projects/:id/undo', (req, reply) => {
  try {
    const r = undoLast(req.params.id);
    emit({type: 'plan', project: req.params.id, version: r.version, by: 'undo'});
    rebuild(req.params.id);
    return r;
  } catch (e) {
    return reply.code(400).send({error: String((e as Error).message)});
  }
});
app.get<{Params: {id: string}}>('/api/projects/:id/cuts', (req, reply) => {
  try {
    return cutCandidates(req.params.id);
  } catch (e) {
    return reply.code(400).send({error: String((e as Error).message)});
  }
});
app.post<{Params: {id: string}}>('/api/projects/:id/build', async (req) => {
  rebuild(req.params.id);
  await building.get(req.params.id);
  return {ok: true};
});

// ---------- analysis: one task at a time per project ----------
const queue = (id: string, fn: () => Promise<unknown>) => {
  const p = (tasks.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
  tasks.set(id, p);
  p.catch((e) => emit({type: 'error', project: id, message: String(e.message ?? e)})).finally(() => tasks.get(id) === p && tasks.delete(id));
  return p;
};
const onStep = (id: string) => (step: string, status: string) => emit({type: 'analysis', project: id, step, status});
const fail400 = (reply: import('fastify').FastifyReply, e: unknown) => reply.code(400).send({error: String((e as Error).message ?? e)});

// videos for a new project from the Studio: each one lands in <home>/inbox first (raw body), then POST /api/projects
const INBOX = path.join(HOME, 'inbox');
app.put<{Params: {name: string}}>('/api/inbox/:name', async (req, reply) => {
  try {
    const name = path.basename(req.params.name).replace(/[^\w.\- ]+/g, '_');
    // a folder per upload keeps the file's own name (the project id comes from it)
    const file = path.join(INBOX, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    await pipeline(req.body as import('node:stream').Readable, fs.createWriteStream(file));
    return {path: file};
  } catch (e) {
    return fail400(reply, e);
  }
});
app.post<{Body: {files: string[]; id?: string; title?: string}}>('/api/projects', async (req, reply) => {
  const files = req.body.files ?? [];
  try {
    const id = await createProject(files, {id: req.body.id, title: req.body.title});
    // the project has its own copies now: uploads waiting in the inbox go
    for (const f of files) if (path.dirname(path.dirname(path.resolve(f))) === INBOX) fs.rmSync(path.dirname(f), {recursive: true, force: true});
    void queue(id, () => analyzeFree(projectDir(id), onStep(id)));
    return {id, status: 'analyzing'};
  } catch (e) {
    return fail400(reply, e);
  }
});
app.post<{Params: {id: string}}>('/api/projects/:id/analyze', (req) => {
  void queue(req.params.id, () => analyzeFree(projectDir(req.params.id), onStep(req.params.id)));
  return {status: 'analyzing'};
});
app.post<{Params: {id: string}}>('/api/projects/:id/transcribe', async (req, reply) => {
  try {
    const r = await queue(req.params.id, () => transcribe(projectDir(req.params.id), onStep(req.params.id))) as Awaited<ReturnType<typeof transcribe>>;
    return {words: r.steps.transcribe?.words, lowConfidence: r.steps.transcribe?.lowConfidence, warnings: r.warnings};
  } catch (e) {
    return fail400(reply, e);
  }
});
app.post<{Params: {id: string}; Body: {style: string}}>('/api/projects/:id/scaffold', async (req, reply) => {
  try {
    const {plan} = scaffold(projectDir(req.params.id), req.body.style);
    emit({type: 'plan', project: req.params.id, version: plan.version, by: 'system'});
    rebuild(req.params.id);
    return {version: plan.version, camera: plan.camera?.mode, lines: plan.captions.lines.length, segments: plan.timeline.segments.length};
  } catch (e) {
    return fail400(reply, e);
  }
});
app.get<{Params: {id: string}}>('/api/projects/:id/sheet', (req, reply) => {
  const dir = projectDir(req.params.id);
  const file = path.join(dir, 'analysis', 'contact.jpg');
  if (!fs.existsSync(file)) return reply.code(404).send({error: 'no contact sheet yet: the analysis is still running'});
  return {image: fs.readFileSync(file).toString('base64'), mime: 'image/jpeg', times: readReport(dir).sheetTimes ?? [], columns: 8};
});

// ---------- Claude on the notes: the prompt to copy, or the user's Claude Code headless in the background ----------
app.get<{Params: {id: string}}>('/api/projects/:id/claude', (req) =>
  ({prompt: notesPrompt(req.params.id), run: claudeStatus(req.params.id), command: claudeCommand(req.params.id)}));
app.post<{Params: {id: string}}>('/api/projects/:id/claude', (req, reply) => {
  try {
    return startClaude(req.params.id, emit);
  } catch (e) {
    return fail400(reply, e);
  }
});
app.delete<{Params: {id: string}}>('/api/projects/:id/claude', (req, reply) => {
  try {
    return stopClaude(req.params.id);
  } catch (e) {
    return fail400(reply, e);
  }
});

// ---------- project files (b-roll, images, audio, anything): raw uploads, one file per request ----------
app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));
app.put<{Params: {id: string; name: string}}>('/api/projects/:id/files/:name', async (req, reply) => {
  try {
    const f = await saveUpload(req.params.id, req.params.name, req.body as import('node:stream').Readable);
    emit({type: 'files', project: req.params.id});
    return f;
  } catch (e) {
    return fail400(reply, e);
  }
});
app.get<{Params: {id: string}}>('/api/projects/:id/files', (req, reply) => {
  try {
    return listFiles(req.params.id);
  } catch (e) {
    return fail400(reply, e);
  }
});
app.delete<{Params: {id: string; key: string}}>('/api/projects/:id/files/:key', (req, reply) => {
  try {
    const r = deleteFile(req.params.id, req.params.key);
    emit({type: 'files', project: req.params.id});
    return r;
  } catch (e) {
    return fail400(reply, e);
  }
});
app.get<{Params: {id: string; '*': string}}>('/api/projects/:id/media/*', (req, reply) =>
  sendFile(inside(path.join(projectDir(req.params.id), 'media'), req.params['*']), req.headers.range, reply));

// ---------- settings: keys (masked), language, data folder; the Claude Code connection ----------
app.get('/api/settings', () => publicSettings());
app.post<{Body: {keys?: Record<string, string | null>; lang?: string; home?: string}}>('/api/settings', (req, reply) => {
  try {
    return saveSettings(req.body ?? {});
  } catch (e) {
    return fail400(reply, e);
  }
});
app.get('/api/claude-code', () => claudeCodeStatus());
app.post('/api/claude-code/connect', async (req, reply) => {
  try {
    return await connectClaudeCode();
  } catch (e) {
    return fail400(reply, e);
  }
});

// ---------- lessons: what the user rejected, kept (rule 2) ----------
app.get<{Querystring: {style?: string}}>('/api/lessons', (req) => {
  const all = loadLessons();
  const name = req.query.style?.split('@')[0];
  return name ? all.filter((l) => l.scope === 'global' || l.scope === `style:${name}`) : all;
});
app.post<{Body: Omit<Lesson, 'id' | 'at'>}>('/api/lessons', (req, reply) => {
  try {
    const l = saveLesson({...req.body, scope: req.body.scope ?? 'global'});
    emit({type: 'lessons'});
    return l;
  } catch (e) {
    return fail400(reply, e);
  }
});
app.delete<{Params: {id: string}}>('/api/lessons/:id', (req, reply) => {
  try {
    const r = deleteLesson(req.params.id);
    emit({type: 'lessons'});
    return r;
  } catch (e) {
    return fail400(reply, e);
  }
});

// ---------- styles ----------
const image = (file: string) => ({image: fs.readFileSync(file).toString('base64'), mime: 'image/jpeg'});
app.get('/api/styles', () => listStyles());
app.get<{Params: {ref: string}}>('/api/styles/:ref', (req, reply) => {
  try {
    if (!req.params.ref.includes('@')) return {ref: req.params.ref, pending: pendingRefs(req.params.ref)};
    return {...styleDetail(req.params.ref), lessons: lessonsFor(loadLessons(), req.params.ref)};
  } catch (e) {
    return fail400(reply, e);
  }
});
// a style's own files (reference sheets, gate sheets), served from styles/<name>/
app.get<{Params: {name: string; '*': string}}>('/api/styles/:name/files/*', (req, reply) =>
  sendFile(inside(path.join(stylesDir(), req.params.name), req.params['*']), req.headers.range, reply));
// a reference reel from the Studio: raw body into the inbox, then studied into the style (a new style starts here)
app.put<{Params: {name: string; file: string}}>('/api/styles/:name/refs/:file', async (req, reply) => {
  const tmp = path.join(HOME, 'inbox', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  try {
    const file = path.join(tmp, path.basename(req.params.file).replace(/[^\w.\- ]+/g, '_'));
    fs.mkdirSync(tmp, {recursive: true});
    await pipeline(req.body as import('node:stream').Readable, fs.createWriteStream(file));
    const refs = await addReferences(req.params.name, [file]);
    emit({type: 'styles', style: req.params.name});
    return {refs};
  } catch (e) {
    return fail400(reply, e);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});
app.get<{Params: {ref: string}}>('/api/styles/:ref/components', (req, reply) => {
  try {
    // usable components only (drafts left out), with their props for the inspector
    const all = loadComponents(req.params.ref);
    return Object.fromEntries(Object.entries(all).map(([ref, m]) => [ref, {kind: m.kind, title: m.title, props: m.props}]));
  } catch (e) {
    return fail400(reply, e);
  }
});
app.get('/api/list', () => ({projects: listProjects(), styles: listStyles()}));
app.post<{Params: {name: string}; Body: {files: string[]}}>('/api/styles/:name/refs', async (req, reply) => {
  try {
    return {refs: await addReferences(req.params.name, req.body.files ?? [])};
  } catch (e) {
    return fail400(reply, e);
  }
});
app.post<{Body: {style: Style; brief: string}}>('/api/styles/save', (req, reply) => {
  try {
    return saveStyle(req.body.style, req.body.brief ?? '');
  } catch (e) {
    return fail400(reply, e);
  }
});
app.post<{Params: {ref: string}; Body: {manifest: ComponentManifest; code: string}}>('/api/styles/:ref/components', async (req, reply) => {
  try {
    const r = await writeComponent(req.params.ref, req.body.manifest, req.body.code ?? '');
    const {sheet, ...rest} = r;
    emit({type: 'component', style: req.params.ref, ref: r.ref, pass: r.pass});
    return {...rest, ...(sheet ? image(sheet) : {})};
  } catch (e) {
    return fail400(reply, e);
  }
});
app.post<{Body: LookArgs}>('/api/look', async (req, reply) => {
  try {
    const r = await look(req.body ?? {});
    return {...image(r.file), info: r.info};
  } catch (e) {
    return fail400(reply, e);
  }
});

// ---------- renders (background jobs); export = a delivery render, loudness to −14 LUFS, and the SRT ----------
type Quality = 'draft' | 'looks' | 'delivery' | 'export';
const renders = new Map<string, {status: 'running' | 'done' | 'failed'; out: string; step?: string; error?: string; lufs?: number}>();
const hfRender = (dir: string, quality: string, out: string) => new Promise<void>((resolve, reject) => {
  const p = spawn(path.join(REPO, 'node_modules', '.bin', 'hyperframes'), ['render', '--quality', quality, '--workers', '4', '--output', out],
    {cwd: path.join(dir, 'render', 'page'), env: {...process.env, HYPERFRAMES_NO_TELEMETRY: '1'}});
  let err = '';
  p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
  p.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve() : reject(new Error(err.slice(-400) || `render exited ${code}`))));
});
app.post<{Params: {id: string}; Body: {quality?: Quality}}>('/api/projects/:id/render', async (req) => {
  const id = req.params.id;
  const quality = req.body?.quality ?? 'draft';
  rebuild(id);
  await building.get(id);
  const {version} = projectState(id);
  const dir = projectDir(id);
  const out = path.join(dir, 'out', quality === 'export' ? `${id}-v${version}.mp4` : `v${version}-${quality}.mp4`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  const key = `${id}:${version}:${quality}`;
  if (renders.get(key)?.status === 'running') return {job: key, ...renders.get(key)};
  const set = (v: Partial<NonNullable<ReturnType<typeof renders.get>>>) => {
    renders.set(key, {...(renders.get(key) ?? {status: 'running', out}), ...v});
    const r = renders.get(key)!;
    emit({type: 'render', project: id, version, quality, status: r.status, step: r.step, error: r.error});
  };
  set({status: 'running', step: 'render'});
  (async () => {
    if (quality !== 'export') return hfRender(dir, quality, out);
    const delivery = path.join(dir, 'out', `v${version}-delivery.mp4`);
    if (!fs.existsSync(delivery)) await hfRender(dir, 'delivery', delivery);
    set({step: 'loudness'});
    const l = await normalizeLoudness(delivery, out, -14, -1);
    fs.writeFileSync(out.replace(/\.mp4$/, '.srt'), srtOf(id));
    renders.set(key, {...renders.get(key)!, lufs: l.integratedLufs});
  })().then(() => set({status: 'done', step: undefined}), (e) => set({status: 'failed', error: String((e as Error).message).slice(-400)}));
  return {job: key, status: 'running', out};
});
app.get<{Querystring: {job: string}}>('/api/render', (req) => renders.get(req.query.job) ?? {status: 'unknown'});

// ---------- my videos: every render and export, newest first, and the files themselves (Range, so they seek) ----------
app.get('/api/videos', () => listVideos());
app.get<{Params: {id: string; '*': string}}>('/api/projects/:id/out/*', (req, reply) =>
  sendFile(inside(path.join(projectDir(req.params.id), 'out'), req.params['*']), req.headers.range, reply));

// ---------- static: project pages (with Range, so video can seek) and the Studio ----------
const TYPES: Record<string, string> = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.srt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4'};
const sendFile = (file: string, range: string | undefined, reply: import('fastify').FastifyReply) => {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(404).send('not found');
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('accept-ranges', 'bytes')
      .header('content-length', end - start + 1).type(type);
    return reply.send(fs.createReadStream(file, {start, end}));
  }
  reply.header('accept-ranges', 'bytes').header('content-length', size).header('cache-control', 'no-cache').type(type);
  return reply.send(fs.createReadStream(file));
};
const inside = (root: string, rel: string) => {
  const f = path.resolve(root, rel);
  if (!f.startsWith(path.resolve(root) + path.sep)) throw new Error('outside');
  return f;
};
// The preview gets the HyperFrames runtime injected (the render adds its own), so seeks, media and hf-seek behave
// exactly as in the render; the page file itself stays the plain build artifact.
const RUNTIME = path.join(REPO, 'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js');
app.get<{Params: {id: string; '*': string}}>('/p/:id/*', (req, reply) => {
  const file = inside(path.join(projectDir(req.params.id), 'render', 'page'), req.params['*'] || 'index.html');
  if (path.basename(file) !== 'index.html' || !fs.existsSync(file)) return sendFile(file, req.headers.range, reply);
  // the render embeds fonts itself; the browser loads the page's font families from Google Fonts
  const raw = fs.readFileSync(file, 'utf8');
  const families = new Set(['Inter', ...[...raw.matchAll(/font-family:'([^']+)'/g)].map((m) => m[1])]);
  const link = `https://fonts.googleapis.com/css2?${[...families].map((f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400;1,700`).join('&')}&display=block`;
  // the WebKitGTK media shim goes first (it does nothing outside Linux WebKit): see static/webkit-media-shim.js
  const html = raw.replace('</head>', `<link rel="stylesheet" href="${link}">\n<script src="/webkit-media-shim.js"></script>\n<script src="/hf-runtime.js"></script>\n</head>`);
  return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(html);
});
app.get('/hf-runtime.js', (req, reply) => sendFile(RUNTIME, undefined, reply));
app.get('/webkit-media-shim.js', (req, reply) => sendFile(path.join(REPO, 'apps/daemon/static/webkit-media-shim.js'), undefined, reply));
app.get('/player.js', (req, reply) =>
  sendFile(path.join(REPO, 'node_modules/@hyperframes/player/dist/hyperframes-player.global.js'), undefined, reply));
// the Studio's build (apps/studio: npm run build -w @motionable/studio); the probe page stays for engine checks
const STUDIO = path.join(REPO, 'apps/studio/dist');
app.get('/', (req, reply) => sendFile(fs.existsSync(path.join(STUDIO, 'index.html')) ? path.join(STUDIO, 'index.html')
  : path.join(REPO, 'apps/daemon/static/probe.html'), undefined, reply));
app.get<{Params: {'*': string}}>('/assets/*', (req, reply) => sendFile(inside(path.join(STUDIO, 'assets'), req.params['*']), undefined, reply));
app.get('/probe', (req, reply) => sendFile(path.join(REPO, 'apps/daemon/static/probe.html'), undefined, reply));

// ---------- start ----------
await app.listen({port: PORT, host: '127.0.0.1'});
fs.mkdirSync(STATE, {recursive: true});
fs.writeFileSync(path.join(STATE, 'daemon.json'), JSON.stringify({port: PORT, pid: process.pid, home: HOME}));
const bye = () => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(STATE, 'daemon.json'), 'utf8'));
    if (d.pid === process.pid) fs.rmSync(path.join(STATE, 'daemon.json'));
  } catch {}
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
console.log(`motionable daemon on http://127.0.0.1:${PORT} (home ${HOME})`);
