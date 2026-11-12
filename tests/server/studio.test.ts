import { connect } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { projectDir } from '../../src/core/paths.js';
import { addTask, fail } from '../../src/core/queue.js';
import { startStudio } from '../../src/server/studio.js';

let prev: string | undefined;
let tmp: string;
let url: string;
let base: string;
let token: string;
let close: () => Promise<void>;
let staticDir: string;

beforeEach(async () => {
  prev = process.env.MOTIONABLE_HOME;
  tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
  process.env.MOTIONABLE_HOME = tmp;
  staticDir = join(tmp, 'static');
  await mkdir(staticDir);
  await writeFile(join(staticDir, 'index.html'), '<h1>hi</h1>');
  await writeFile(join(tmp, 'secret.txt'), 'SECRET');
  const s = await startStudio({ port: 0, staticDir });
  url = s.url;
  close = s.close;
  base = new URL(url).origin;
  token = new URL(url).searchParams.get('t')!;
});

afterEach(async () => {
  await close();
  if (prev === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prev;
  await rm(tmp, { recursive: true, force: true });
});

const H = () => ({ 'x-motionable-token': token });
const api = (path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { ...H(), ...(init.headers as object) } });
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
async function mk(): Promise<string> {
  return ((await (await api('/api/projects', json({ name: 'Demo', brief: 'b' }))).json()) as { id: string }).id;
}

describe('studio', () => {
  test('rejects request without token', async () => {
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects?t=nope`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects?t=${token}`)).status).toBe(200);
  });

  test('binds to 127.0.0.1 only and writes studio.json', async () => {
    expect(new URL(url).hostname).toBe('127.0.0.1');
    const f = join(tmp, 'studio.json');
    const j = JSON.parse(await readFile(f, 'utf8'));
    expect(j).toMatchObject({ token, pid: process.pid, port: Number(new URL(url).port) });
    expect((await stat(f)).mode & 0o777).toBe(0o600);
  });

  const raw = (path: string) =>
    new Promise<string>((resolve) => {
      const s = connect(Number(new URL(url).port), '127.0.0.1', () =>
        s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`),
      );
      let buf = '';
      s.on('data', (d) => (buf += d));
      s.on('close', () => resolve(buf));
    });

  test('static serves index without token', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<h1>hi</h1>');
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
  });

  test('static blocks traversal (raw paths)', async () => {
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/../secret.txt', '/%2e%2e%2fsecret.txt']) {
      const out = await raw(p);
      expect(out).toMatch(/^HTTP\/1\.1 (400|404)/);
      expect(out).not.toContain('SECRET');
    }
  });

  test('project create, get, tasks, bad id', async () => {
    const id = await mk();
    const g = (await (await api(`/api/projects/${id}`)).json()) as any;
    expect(g.project.id).toBe(id);
    expect(g.plan).toBeNull();
    expect(g.chat).toEqual([]);
    expect(g.tasks).toEqual([]);
    expect((await api('/api/projects/nope-123456')).status).toBe(404);
    expect((await api('/api/projects/..%2Fx')).status).toBe(400);
    expect((await api('/api/projects/BAD')).status).toBe(400);
  });

  test('tasks: allowed types only', async () => {
    const id = await mk();
    expect((await api(`/api/projects/${id}/tasks`, json({ type: 'edit', input: {} }))).status).toBe(400);
    expect((await api(`/api/projects/${id}/tasks`, json({ type: 'generate', input: {} }))).status).toBe(400);
    const r = await api(`/api/projects/${id}/tasks`, json({ type: 'study_ref', input: { a: 1 } }));
    expect(r.status).toBe(200);
    const t = (await r.json()) as any;
    expect(t.type).toBe('study_ref');
  });

  test('approve task, bad task id 400, 409 when not awaiting', async () => {
    const id = await mk();
    const t = await addTask(id, 'generate', {}, 'awaiting_approval');
    expect((await api(`/api/projects/${id}/tasks/${t.id}/approve`, { method: 'POST' })).status).toBe(200);
    const again = await api(`/api/projects/${id}/tasks/${t.id}/approve`, { method: 'POST' });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'not_awaiting_approval' });
    expect((await api(`/api/projects/${id}/tasks/..%2F..%2Fx/approve`, { method: 'POST' })).status).toBe(400);
    expect((await api(`/api/projects/${id}/tasks/abc/approve`, { method: 'POST' })).status).toBe(404);
  });

  test('execute: 409 while another execute is queued or running', async () => {
    const id = await mk();
    const post = () => api(`/api/projects/${id}/tasks`, json({ type: 'execute', input: {} }));
    expect((await post()).status).toBe(200);
    const r = await post();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'execute_in_progress' });
  });

  test('execute allowed again after the previous one failed', async () => {
    const id = await mk();
    const ex = await addTask(id, 'execute', {});
    await fail(id, ex.id, 'boom');
    expect((await api(`/api/projects/${id}/tasks`, json({ type: 'execute', input: {} }))).status).toBe(200);
  });

  test('torn plan.json gives plan:null + planError, not an error status', async () => {
    const id = await mk();
    await writeFile(join(projectDir(id), 'plan.json'), '{"scenes": [');
    let g = (await (await api(`/api/projects/${id}`)).json()) as any;
    expect(g.plan).toBeNull();
    expect(g.planError).toBe('invalid');
    await writeFile(join(projectDir(id), 'plan.json'), '{"nope": 1}');
    g = (await (await api(`/api/projects/${id}`)).json()) as any;
    expect(g.plan).toBeNull();
    expect(g.planError).toBe('invalid');
  });

  test('refs upload accepts video only', async () => {
    const id = await mk();
    const up = (name: string) => api(`/api/projects/${id}/upload?kind=refs`, { method: 'POST', headers: { 'x-filename': name }, body: 'd' });
    expect((await up('a.png')).status).toBe(400);
    expect((await up('a.mp3')).status).toBe(400);
    expect((await up('a.webm')).status).toBe(200);
  });

  test('GET /api/prices returns the rate table', async () => {
    const p = (await (await api('/api/prices')).json()) as any;
    expect(p.stt.perMinute).toBe(0.007);
  });

  test('decline: only awaiting_approval generate tasks', async () => {
    const id = await mk();
    const gen = await addTask(id, 'generate', { sceneId: 's1', kind: 'image' }, 'awaiting_approval');
    const done = await addTask(id, 'generate', {}, 'queued');
    const ex = (await (await api(`/api/projects/${id}/tasks`, json({ type: 'execute', input: {} }))).json()) as any;
    expect((await api(`/api/projects/${id}/tasks/${done.id}/decline`, { method: 'POST' })).status).toBe(400);
    expect((await api(`/api/projects/${id}/tasks/${ex.id}/decline`, { method: 'POST' })).status).toBe(400);
    expect((await api(`/api/projects/${id}/tasks/nope/decline`, { method: 'POST' })).status).toBe(404);
    const r = await api(`/api/projects/${id}/tasks/${gen.id}/decline`, { method: 'POST' });
    expect(r.status).toBe(200);
    const t = (await r.json()) as any;
    expect(t.status).toBe('failed');
    expect(t.error).toBe('declined');
    expect((await api(`/api/projects/${id}/tasks/${gen.id}/decline`, { method: 'POST' })).status).toBe(400);
  });

  test('chat adds edit task', async () => {
    const id = await mk();
    const r = await api(`/api/projects/${id}/chat`, json({ text: 'make it faster' }));
    expect(r.status).toBe(200);
    const { msg, task } = (await r.json()) as any;
    expect(msg.role).toBe('user');
    expect(task.type).toBe('edit');
    expect(task.input).toMatchObject({ msgId: msg.id, text: 'make it faster' });
    const g = (await (await api(`/api/projects/${id}`)).json()) as any;
    expect(g.chat).toHaveLength(1);
    expect(g.tasks).toHaveLength(1);
  });

  test('config GET is masked, PUT saves', async () => {
    const put = await api('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers: { image: { use: 'kie', key: 'secret-key-1234' } } }),
    });
    expect(put.status).toBe(200);
    const c = (await (await api('/api/config')).json()) as any;
    expect(c.providers.image.key).toBe('••••1234');
    expect(JSON.stringify(c)).not.toContain('secret-key');
  });

  test('claude heartbeat', async () => {
    expect(await (await api('/api/claude')).json()).toEqual({ connected: false });
    await writeFile(join(tmp, 'heartbeat'), '');
    expect(await (await api('/api/claude')).json()).toEqual({ connected: true });
    const old = new Date(Date.now() - 400_000);
    await utimes(join(tmp, 'heartbeat'), old, old);
    expect(await (await api('/api/claude')).json()).toEqual({ connected: false });
  });

  test('upload ok, collision suffix, bad names, bad kind', async () => {
    const id = await mk();
    const up = (name: string, kind = 'broll', body = 'data') =>
      api(`/api/projects/${id}/upload?kind=${kind}`, { method: 'POST', headers: { 'x-filename': name }, body });
    expect((await up('a.mp4')).status).toBe(200);
    expect((await up('a.mp4')).status).toBe(200);
    expect((await readdir(join(projectDir(id), 'broll'))).sort()).toEqual(['a-1.mp4', 'a.mp4']);
    await rm(join(projectDir(id), 'broll'), { recursive: true });
    expect((await up('b.mp4')).status).toBe(200);
    expect((await up('../evil.mp4')).status).toBe(400);
    expect((await up('sub/evil.mp4')).status).toBe(400);
    expect((await up('a..b.mp4')).status).toBe(400);
    expect((await up('x.exe')).status).toBe(400);
    expect((await up('a.mp4', 'other')).status).toBe(400);
    expect((await up('CON.mp4')).status).toBe(400);
    expect((await up('a%3Ab.mp4')).status).toBe(400);
    expect((await up('%E0%A4%A.mp4')).status).toBe(400);
    expect((await up('x'.repeat(201) + '.mp4')).status).toBe(400);
    expect((await up(encodeURIComponent("Ko'chmas mulk.mp4"))).status).toBe(200);
    expect(await readdir(join(projectDir(id), 'broll'))).toContain("Ko'chmas mulk.mp4");
    expect((await up('r.png', 'refs')).status).toBe(400);
    expect((await up('r.png', 'broll')).status).toBe(200);
  });

  test('interrupted upload leaves no file', async () => {
    const id = await mk();
    await new Promise<void>((resolve) => {
      const s = connect(Number(new URL(url).port), '127.0.0.1', () => {
        s.write(
          `POST /api/projects/${id}/upload?kind=broll HTTP/1.1\r\nHost: x\r\nx-motionable-token: ${token}\r\nx-filename: half.mp4\r\nContent-Length: 1000000\r\n\r\n` +
            'x'.repeat(5000),
        );
        setTimeout(() => {
          s.destroy();
          resolve();
        }, 150);
      });
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(await readdir(join(projectDir(id), 'broll'))).toEqual([]);
  });

  test('concurrent same-name uploads both succeed', async () => {
    const id = await mk();
    const sock = connect(Number(new URL(url).port), '127.0.0.1');
    await new Promise<void>((r) => sock.once('connect', () => r()));
    sock.write(
      `POST /api/projects/${id}/upload?kind=broll HTTP/1.1\r\nHost: x\r\nx-motionable-token: ${token}\r\nx-filename: a.mp4\r\nContent-Length: 10\r\n\r\nabcde`,
    );
    await new Promise((r) => setTimeout(r, 200));
    const second = await api(`/api/projects/${id}/upload?kind=broll`, {
      method: 'POST',
      headers: { 'x-filename': 'a.mp4' },
      body: 'second',
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as any).name).toBe('a-1.mp4');
    const done = new Promise<string>((r) => {
      let b = '';
      sock.on('data', (d) => {
        b += d;
        if (b.includes('\r\n\r\n')) r(b);
      });
    });
    sock.write('fghij');
    const out = await done;
    sock.destroy();
    expect(out).toMatch(/^HTTP\/1\.1 200/);
    const dir = join(projectDir(id), 'broll');
    expect((await readdir(dir)).sort()).toEqual(['a-1.mp4', 'a.mp4']);
    expect(await readFile(join(dir, 'a.mp4'), 'utf8')).toBe('abcdefghij');
  });

  test('chat files must exist in broll/refs', async () => {
    const id = await mk();
    await api(`/api/projects/${id}/upload?kind=broll`, { method: 'POST', headers: { 'x-filename': 'x.mp4' }, body: 'd' });
    const chat = (files: unknown) => api(`/api/projects/${id}/chat`, json({ text: 'hi', files }));
    expect((await chat(['missing.mp4'])).status).toBe(400);
    expect((await chat(['../x.mp4'])).status).toBe(400);
    expect((await chat(['broll/x.mp4'])).status).toBe(400);
    expect((await chat('x.mp4')).status).toBe(400);
    const ok = (await (await chat(['x.mp4'])).json()) as any;
    expect(ok.msg.files).toEqual(['broll/x.mp4']);
    expect(ok.task.input.files).toEqual(['broll/x.mp4']);
  });

  test('SSE emits project event after task added', async () => {
    const id = await mk();
    const ctl = new AbortController();
    const res = await fetch(`${base}/api/events?t=${token}`, { signal: ctl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    await new Promise((r) => setTimeout(r, 100));
    await api(`/api/projects/${id}/tasks`, json({ type: 'study_ref', input: {} }));
    let buf = '';
    const dec = new TextDecoder();
    const deadline = Date.now() + 5000;
    while (!buf.includes(`"id":"${id}"`) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    ctl.abort();
    expect(buf).toContain(`data: {"type":"project","id":"${id}"}\n\n`);
  });

  test('SSE needs token', async () => {
    expect((await fetch(`${base}/api/events`)).status).toBe(401);
  });
  test('GET /api/styles lists saved style summaries and skips unreadable ones', async () => {
    expect(await (await api('/api/styles')).json()).toEqual([]);
    const style = {
      pace: { avgShotSeconds: 1.8, cutsPerMin: 33 },
      framing: 'tight talking head',
      captions: { fontFamily: 'Inter', weight: 800, case: 'upper', position: 'center', highlight: '#ff0', wordsPerLine: 3 },
      textCards: { when: 'hook', look: 'white card' },
      transitions: ['cut'],
      colour: { palette: ['#F4F1EA', '#C9643F'], grade: 'warm' },
      motion: [{ name: 'pop', timing: '200ms' }],
      audio: { musicEnergy: 'low', sfx: 'whoosh' },
      doNot: [],
      sheets: ['s1.jpg'],
    };
    await mkdir(join(tmp, 'styles', 'warm-talk'), { recursive: true });
    await writeFile(join(tmp, 'styles', 'warm-talk', 'style.json'), JSON.stringify(style));
    await mkdir(join(tmp, 'styles', 'broken'), { recursive: true });
    await writeFile(join(tmp, 'styles', 'broken', 'style.json'), '{nope');
    await mkdir(join(tmp, 'styles', 'empty'), { recursive: true });
    const res = await api('/api/styles');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: 'warm-talk',
        framing: 'tight talking head',
        pace: { avgShotSeconds: 1.8, cutsPerMin: 33 },
        palette: ['#F4F1EA', '#C9643F'],
        fontFamily: 'Inter',
        transitions: ['cut'],
      },
    ]);
    expect((await fetch(`${base}/api/styles`)).status).toBe(401);
  });
});
