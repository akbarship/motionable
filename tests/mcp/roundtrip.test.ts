import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { listTasks } from '../../src/core/queue.js';
import { createMcpServer, ensureStudio } from '../../src/mcp/server.js';
import { LocalSttUnavailable } from '../../src/providers/local-stt.js';
import { startStudio } from '../../src/server/studio.js';

const saved: Record<string, string | undefined> = {};
let tmp: string;
let base: string;
let token: string;
let studioUrl: string;
let closeStudio: () => Promise<void>;
let client: Client;
/** This test chat; projects created with its header are worked by its next_task. */
const SID = '0123456789abcdef';

beforeEach(async () => {
  for (const k of ['MOTIONABLE_HOME', 'MOTIONABLE_WAIT_S', 'MOTIONABLE_NO_OPEN']) saved[k] = process.env[k];
  tmp = await mkdtemp(join(tmpdir(), 'motionable-mcp-'));
  process.env.MOTIONABLE_HOME = tmp;
  process.env.MOTIONABLE_NO_OPEN = '1';
  const s = await startStudio({ port: 0, staticDir: tmp });
  studioUrl = s.url;
  closeStudio = s.close;
  base = new URL(s.url).origin;
  token = new URL(s.url).searchParams.get('t')!;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer({ session: SID }).connect(a);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
});

afterEach(async () => {
  await client.close();
  await closeStudio();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-motionable-token': token, 'x-motionable-session': SID },
    body: JSON.stringify(body),
  });
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: r.isError, data: JSON.parse(r.content[0].text) };
}

describe('mcp roundtrip', () => {
  test('lists tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['generate', 'next_task', 'project_info', 'request_generation', 'studio_open', 'task_done', 'task_failed', 'task_progress', 'transcribe']);
  });

  test('next_task -> progress -> done, SSE emits, project_info', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'study_ref', input: { url: 'x' } });

    const ctl = new AbortController();
    const sse = await fetch(`${base}/api/events?t=${token}`, { signal: ctl.signal });
    const reader = sse.body!.getReader();
    await new Promise((r) => setTimeout(r, 100));

    const t = (await call('next_task')).data;
    expect(t).toMatchObject({ projectId: id, type: 'study_ref', agent: 'ref-study', input: { url: 'x' } });
    expect(t.projectDir).toContain(id);
    expect(isAbsolute(t.cliPath)).toBe(true);
    expect(t.cliPath).toMatch(/dist[\\/]cli\.js$/);

    expect((await call('task_progress', { projectId: id, taskId: t.taskId, line: 'half' })).data).toEqual({ ok: true });
    expect((await call('task_done', { projectId: id, taskId: t.taskId, summary: 'did it' })).data).toEqual({ ok: true });

    const tasks = await listTasks(id);
    expect(tasks[0]).toMatchObject({ status: 'done', output: { summary: 'did it' }, progress: ['half'] });

    let buf = '';
    const dec = new TextDecoder();
    const deadline = Date.now() + 5000;
    while (!buf.includes(`"id":"${id}"`) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    ctl.abort();
    expect(buf).toContain(`"type":"project","id":"${id}"`);

    const info = (await call('project_info', { projectId: id })).data;
    expect(info).toMatchObject({ projectId: id, name: 'Demo', hasPlan: false, cliPath: t.cliPath });
    expect(info.providers).toEqual({ image: false, video: false, tts: false, stt: false });
    expect(info.tasks).toEqual([{ id: t.taskId, type: 'study_ref', status: 'done' }]);
  });

  test('task_failed closes task', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'direct', input: {} });
    const t = (await call('next_task')).data;
    expect(t.agent).toBe('director');
    await call('task_failed', { projectId: id, taskId: t.taskId, error: 'boom' });
    expect((await listTasks(id))[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });

  test('idle poll returns idle fast and touches heartbeat', async () => {
    process.env.MOTIONABLE_WAIT_S = '1';
    const t0 = Date.now();
    const r = await call('next_task');
    expect(r.data).toEqual({ idle: true });
    expect(Date.now() - t0).toBeLessThan(2000);
    const hb = await fetch(`${base}/api/claude?t=${token}`);
    expect(JSON.stringify(await hb.json())).toContain('true');
  });

  test('task_progress refreshes heartbeat mtime', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'direct', input: {} });
    const t = (await call('next_task')).data;
    const hbFile = join(tmp, 'heartbeat');
    const old = new Date(Date.now() - 600_000);
    await utimes(hbFile, old, old);
    await call('task_progress', { projectId: id, taskId: t.taskId, line: 'x' });
    expect(Date.now() - (await stat(hbFile)).mtimeMs).toBeLessThan(5000);
  });

  test('studio_open reuses running studio and binds the tab to this chat', async () => {
    const r = (await call('studio_open')).data;
    expect(r.url).toBe(`${studioUrl}&s=${SID}#/new`);
    expect(r.say).toBe(`Studio: [${r.url}](${r.url})`);
  });

  test('a Studio from another build is shut down and replaced', async () => {
    let next: Awaited<ReturnType<typeof startStudio>> | null = null;
    const spawn = () => {
      void (async () => {
        next = await startStudio({ port: 0, staticDir: tmp });
        // Same test process: record another live pid so ensureStudio sees a new Studio.
        const f = join(tmp, 'studio.json');
        const info = JSON.parse(await readFile(f, 'utf8'));
        await writeFile(f, JSON.stringify({ ...info, pid: process.ppid }));
      })();
    };
    const url = await ensureStudio(spawn, 'newer-build');
    expect(url).not.toBe(studioUrl);
    expect(await fetch(`${base}/api/claude?t=${token}`).catch(() => null)).toBeNull(); // old one is gone
    await next!.close();
  });

  test('next_task only takes projects bound to this chat', async () => {
    process.env.MOTIONABLE_WAIT_S = '1';
    const other = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-motionable-token': token, 'x-motionable-session': 'fedcba9876543210' },
        body: JSON.stringify({ name: 'Other', brief: '' }),
      })
    ).json()) as { id: string };
    const plain = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-motionable-token': token },
        body: JSON.stringify({ name: 'Plain', brief: '' }),
      })
    ).json()) as { id: string };
    await post(`/api/projects/${other.id}/tasks`, { type: 'study_ref', input: {} });
    await post(`/api/projects/${plain.id}/tasks`, { type: 'study_ref', input: {} });
    expect((await call('next_task')).data).toEqual({ idle: true });
    // Opening the project in this chat's tab takes it over.
    await fetch(`${base}/api/projects/${other.id}`, { headers: { 'x-motionable-token': token, 'x-motionable-session': SID } });
    const t = (await call('next_task')).data;
    expect(t.projectId).toBe(other.id);
  });

  test('rejects path-like ids and touches nothing outside tasks/', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await writeFile(join(tmp, 'projects', 'x.json'), 'KEEP');
    for (const tool of ['task_progress', 'task_done', 'task_failed']) {
      const r = (await client.callTool({
        name: tool,
        arguments: { projectId: id, taskId: '../../x', line: 'l', summary: 's', error: 'e' },
      })) as { isError?: boolean };
      expect(r.isError).toBe(true);
    }
    expect(await readFile(join(tmp, 'projects', 'x.json'), 'utf8')).toBe('KEEP');
    expect((await readdir(join(tmp, 'projects', id, 'tasks')).catch(() => [])).length).toBe(0);
  });

  test('NaN wait falls back to a positive number', async () => {
    process.env.MOTIONABLE_WAIT_S = 'abc';
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'study_ref', input: {} });
    expect((await call('next_task')).data.type).toBe('study_ref');
  });
  test('task_done never queues a render by itself (the Editor shows a live player)', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'execute', input: {} });
    const t = (await call('next_task')).data;
    await call('task_done', { projectId: id, taskId: t.taskId, summary: 'built' });
    expect((await listTasks(id)).filter((x) => x.type === 'render')).toHaveLength(0);
  });

  test('transcribe falls back to free local whisper, and says how to install it when missing', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await writeFile(join(tmp, 'projects', id, 'broll', 'vo.wav'), 'x');
    const mkClient = async (localStt: Parameters<typeof createMcpServer>[0] extends infer O ? O extends { localStt?: infer L } ? L : never : never) => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await createMcpServer({ session: SID, localStt }).connect(a);
      const c = new Client({ name: 't', version: '0' });
      await c.connect(b);
      return c;
    };
    const ok = await mkClient(async () => [{ w: 'salom', start: 0, end: 0.4 }]);
    const r = (await ok.callTool({ name: 'transcribe', arguments: { projectId: id, file: 'broll/vo.wav' } })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0].text)).toEqual({ wordsPath: 'broll/vo.words.json', engine: 'local' });
    await ok.close();
    const missing = await mkClient(async () => {
      throw new LocalSttUnavailable('sudo apt-get install -y git cmake build-essential');
    });
    const m = (await missing.callTool({ name: 'transcribe', arguments: { projectId: id, file: 'broll/vo.wav' } })) as { content: { text: string }[] };
    expect(JSON.parse(m.content[0].text)).toEqual({ error: 'no_stt_provider', hint: 'sudo apt-get install -y git cmake build-essential' });
    await missing.close();
  });

  test('a task this chat took but never finished is handed out again, once finished it is not', async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'direct', input: {} });
    const first = (await call('next_task')).data;
    expect(first.type).toBe('direct');
    expect(first.resumed).toBeUndefined();
    const again = (await call('next_task')).data;
    expect(again).toMatchObject({ taskId: first.taskId, type: 'direct', resumed: true });
    await call('task_done', { projectId: id, taskId: first.taskId, summary: 'ok' });
    process.env.MOTIONABLE_WAIT_S = '1';
    expect((await call('next_task')).data).toEqual({ idle: true });
  });

  test("another chat's running task is never handed out", async () => {
    const { id } = (await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string };
    await post(`/api/projects/${id}/tasks`, { type: 'direct', input: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer({ session: SID }).connect(a);
    const other = new Client({ name: 'other', version: '0' });
    await other.connect(b);
    const r = (await other.callTool({ name: 'next_task', arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(r.content[0].text).type).toBe('direct');
    process.env.MOTIONABLE_WAIT_S = '1';
    expect((await call('next_task')).data).toEqual({ idle: true });
    await other.close();
  });
});
