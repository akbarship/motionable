import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { listTasks } from '../../src/core/queue.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { startStudio } from '../../src/server/studio.js';

const saved: Record<string, string | undefined> = {};
let tmp: string;
let base: string;
let token: string;
let studioUrl: string;
let closeStudio: () => Promise<void>;
let client: Client;

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
  await createMcpServer().connect(a);
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
    headers: { 'content-type': 'application/json', 'x-motionable-token': token },
    body: JSON.stringify(body),
  });
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: r.isError, data: JSON.parse(r.content[0].text) };
}

describe('mcp roundtrip', () => {
  test('lists tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['next_task', 'project_info', 'studio_open', 'task_done', 'task_failed', 'task_progress']);
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
    expect(info).toMatchObject({ projectId: id, name: 'Demo', hasPlan: false });
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

  test('studio_open reuses running studio', async () => {
    const r = (await call('studio_open')).data;
    expect(r.url).toBe(studioUrl);
    expect(r.projectId).toBeNull();
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
});
