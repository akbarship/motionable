import { connect } from 'node:net';
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { projectDir } from '../../src/core/paths.js';
import { startStudio } from '../../src/server/studio.js';

let prev: string | undefined;
let tmp: string;
let url: string;
let base: string;
let token: string;
let close: () => Promise<void>;

beforeEach(async () => {
  prev = process.env.MOTIONABLE_HOME;
  tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
  process.env.MOTIONABLE_HOME = tmp;
  const s = await startStudio({ port: 0 });
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

  test('static does not need token, 404 when missing', async () => {
    const r = await fetch(`${base}/`);
    expect([200, 404]).toContain(r.status);
    expect((await fetch(`${base}/../package.json`)).status).not.toBe(200);
    expect((await fetch(`${base}/%2e%2e/%2e%2e/package.json`)).status).not.toBe(200);
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

  test('approve task, bad task id 400', async () => {
    const id = await mk();
    const t = (await (await api(`/api/projects/${id}/tasks`, json({ type: 'execute', input: {} }))).json()) as any;
    expect((await api(`/api/projects/${id}/tasks/${t.id}/approve`, { method: 'POST' })).status).toBe(200);
    expect((await api(`/api/projects/${id}/tasks/..%2F..%2Fx/approve`, { method: 'POST' })).status).toBe(400);
    expect((await api(`/api/projects/${id}/tasks/abc/approve`, { method: 'POST' })).status).toBe(404);
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
    expect((await up('../evil.mp4')).status).toBe(400);
    expect((await up('sub/evil.mp4')).status).toBe(400);
    expect((await up('a..b.mp4')).status).toBe(400);
    expect((await up('x.exe')).status).toBe(400);
    expect((await up('a.mp4', 'other')).status).toBe(400);
    expect((await up('r.png', 'refs')).status).toBe(200);
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
});
