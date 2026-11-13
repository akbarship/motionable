import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { saveConfig } from '../../src/core/config.js';
import { projectDir } from '../../src/core/paths.js';
import { approve, claimNext, listTasks } from '../../src/core/queue.js';
import { createProject } from '../../src/core/store.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { LocalSttUnavailable } from '../../src/providers/local-stt.js';
import type { GenerationProvider } from '../../src/providers/types.js';
import { startStudio } from '../../src/server/studio.js';
import { startMockBot, type MockBot } from './bot-mock.js';

let prev: string | undefined;
let tmp: string;
let client: Client;
let runs = 0;

let quoteUsd = 0.5;
let runUsd = 0.5;
let runImpl: ((r: Parameters<GenerationProvider['run']>[0]) => Promise<void>) | null = null;
const seenResume: (string | undefined)[] = [];

const fake: GenerationProvider = {
  kinds: ['image', 'stt'],
  quote: async () => ({ usd: quoteUsd }),
  run: async (r) => {
    runs += 1;
    seenResume.push(r.resumeJobId);
    await runImpl?.(r);
    const file = join(r.outDir, `${r.taskId}.png`);
    await mkdir(r.outDir, { recursive: true });
    await writeFile(file, 'img');
    return { file, usd: runUsd };
  },
  transcribe: async () => [{ w: 'hi', start: 0, end: 1 }],
};
let withProvider = true;

beforeEach(async () => {
  prev = process.env.MOTIONABLE_HOME;
  tmp = await mkdtemp(join(tmpdir(), 'motionable-tools-'));
  process.env.MOTIONABLE_HOME = tmp;
  runs = 0;
  quoteUsd = 0.5;
  runUsd = 0.5;
  runImpl = null;
  seenResume.length = 0;
  withProvider = true;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer({
    providerFor: () => (withProvider ? fake : null),
    localStt: async () => {
      throw new LocalSttUnavailable('install whisper');
    },
  }).connect(a);
  client = new Client({ name: 't', version: '0' });
  await client.connect(b);
});
afterEach(async () => {
  await client.close();
  if (prev === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prev;
  await rm(tmp, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { isError: r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
}

describe('generation tools', () => {
  test('no provider gives no_provider and queues nothing', async () => {
    withProvider = false;
    const p = await createProject({ name: 'A', brief: '' });
    const r = await call('request_generation', { projectId: p.id, sceneId: 's1', kind: 'image', params: { prompt: 'x' } });
    expect(r.data).toEqual({ error: 'no_provider' });
    expect(await listTasks(p.id)).toEqual([]);
  });

  test('request -> refused until approved -> generate once, logs', async () => {
    const p = await createProject({ name: 'A', brief: '' });
    const r = await call('request_generation', { projectId: p.id, sceneId: 's1', kind: 'image', params: { prompt: 'x' } });
    expect(r.data.usd).toBe(0.5);
    const id = r.data.taskId as string;
    expect((await listTasks(p.id))[0]).toMatchObject({ status: 'awaiting_approval', input: { sceneId: 's1', usd: 0.5 } });

    expect((await call('generate', { projectId: p.id, taskId: id })).data).toEqual({ error: 'not_approved' });
    await approve(p.id, id);
    expect((await call('generate', { projectId: p.id, taskId: id })).data).toEqual({ error: 'not_approved' }); // queued, not running
    expect(runs).toBe(0);

    await claimNext();
    const g = await call('generate', { projectId: p.id, taskId: id });
    expect(g.data).toEqual({ file: `gen/${id}.png`, usd: 0.5 });
    const log = (await readFile(join(projectDir(p.id), 'gen', 'gen.log.jsonl'), 'utf8')).trim().split('\n');
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0])).toMatchObject({ taskId: id, kind: 'image', usd: 0.5, file: `gen/${id}.png` });

    expect((await call('generate', { projectId: p.id, taskId: id })).data).toEqual({ error: 'already_generated' });
    expect(runs).toBe(1);
  });

  test('transcribe writes words.json next to media and rejects escapes', async () => {
    const p = await createProject({ name: 'A', brief: '' });
    const dir = projectDir(p.id);
    await writeFile(join(dir, 'broll', 'clip.mp3'), 'a');
    const r = await call('transcribe', { projectId: p.id, file: 'broll/clip.mp3' });
    expect(r.data).toEqual({ wordsPath: 'broll/clip.words.json', engine: 'provider' });
    expect(JSON.parse(await readFile(join(dir, r.data.wordsPath), 'utf8'))).toEqual([{ w: 'hi', start: 0, end: 1 }]);

    expect((await call('transcribe', { projectId: p.id, file: '../../x.mp3' })).isError).toBe(true);
    expect((await call('transcribe', { projectId: p.id, file: '/etc/passwd' })).isError).toBe(true);
    await writeFile(join(tmp, 'outside.mp3'), 'x');
    await symlink(join(tmp, 'outside.mp3'), join(dir, 'broll', 'link.mp3'));
    expect((await call('transcribe', { projectId: p.id, file: 'broll/link.mp3' })).isError).toBe(true);

    withProvider = false;
    expect((await call('transcribe', { projectId: p.id, file: 'broll/clip.mp3' })).data).toEqual({ error: 'no_stt_provider', hint: 'install whisper' });
  });
});

async function approved(): Promise<{ pid: string; id: string }> {
  const p = await createProject({ name: 'G', brief: '' });
  const r = await call('request_generation', { projectId: p.id, sceneId: 's', kind: 'image', params: { prompt: 'x' } });
  await approve(p.id, r.data.taskId);
  await claimNext();
  return { pid: p.id, id: r.data.taskId };
}

describe('paid run safety', () => {
  test('two concurrent generate calls run the provider once', async () => {
    const { pid, id } = await approved();
    runImpl = () => new Promise((r) => setTimeout(r, 80));
    const [a, b] = await Promise.all([
      call('generate', { projectId: pid, taskId: id }),
      call('generate', { projectId: pid, taskId: id }),
    ]);
    expect(runs).toBe(1);
    const results = [a.data, b.data];
    expect(results.filter((d) => d.error === 'already_started')).toHaveLength(1);
    expect(results.filter((d) => d.file)).toHaveLength(1);
  });

  test('retry after poll timeout resumes the same job', async () => {
    const { pid, id } = await approved();
    runImpl = async (r) => {
      if (!r.resumeJobId) {
        await r.onJobId?.('job-42');
        throw new Error('generation timed out');
      }
    };
    expect((await call('generate', { projectId: pid, taskId: id })).isError).toBe(true);
    const g = await call('generate', { projectId: pid, taskId: id });
    expect(g.data.file).toBe(`gen/${id}.png`);
    expect(seenResume).toEqual([undefined, 'job-42']);
  });

  test('failure before a job exists allows a clean retry', async () => {
    const { pid, id } = await approved();
    runImpl = async () => {
      runImpl = null;
      throw new Error('boom');
    };
    expect((await call('generate', { projectId: pid, taskId: id })).isError).toBe(true);
    expect((await call('generate', { projectId: pid, taskId: id })).data.file).toBeDefined();
    await expect(stat(join(projectDir(pid), 'gen', `${id}.started`))).resolves.toBeDefined(); // success leaves marker
  });

  test('error before the attempt removes the marker', async () => {
    const { pid, id } = await approved();
    runImpl = async () => {
      throw new Error('validation');
    };
    expect((await call('generate', { projectId: pid, taskId: id })).isError).toBe(true);
    await expect(stat(join(projectDir(pid), 'gen', `${id}.started`))).rejects.toThrow();
  });

  test('error after the create attempt keeps the marker; retry is already_started', async () => {
    const { pid, id } = await approved();
    runImpl = async (r) => {
      await r.onCreateAttempt?.();
      throw new TypeError('fetch failed');
    };
    expect((await call('generate', { projectId: pid, taskId: id })).isError).toBe(true);
    const again = await call('generate', { projectId: pid, taskId: id });
    expect(again.data).toEqual({ error: 'already_started', hint: 'unknown_job_state' });
    expect(runs).toBe(1);
    await stat(join(projectDir(pid), 'gen', `${id}.started`));
  });

  test('provider_changed refuses', async () => {
    const { pid, id } = await approved();
    await saveConfig({ providers: { image: { use: 'kie', key: 'k' } } });
    expect((await call('generate', { projectId: pid, taskId: id })).data).toEqual({ error: 'provider_changed' });
    expect(runs).toBe(0);
  });

  test('price_changed refuses before running; price_exceeded keeps the file', async () => {
    let t = await approved();
    quoteUsd = 0.61;
    expect((await call('generate', { projectId: t.pid, taskId: t.id })).data).toEqual({ error: 'price_changed', usd: 0.61 });
    expect(runs).toBe(0);
    quoteUsd = 0.5;
    t = await approved();
    runUsd = 0.9;
    const g = await call('generate', { projectId: t.pid, taskId: t.id });
    expect(g.data).toMatchObject({ file: `gen/${t.id}.png`, usd: 0.9, warning: 'price_exceeded' });
    const log = (await readFile(join(projectDir(t.pid), 'gen', 'gen.log.jsonl'), 'utf8')).trim();
    expect(JSON.parse(log).warning).toBe('price_exceeded');
  });
});

describe('studio routes', () => {
  let bot: MockBot;
  let close: () => Promise<void>;
  let base: string;
  let token: string;
  beforeEach(async () => {
    bot = await startMockBot({ balance: 7, usd: 0.4 });
    const s = await startStudio({ port: 0, staticDir: tmp });
    close = s.close;
    base = new URL(s.url).origin;
    token = new URL(s.url).searchParams.get('t')!;
  });
  afterEach(async () => {
    await close();
    await bot.close();
  });
  const api = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-motionable-token': token },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  test('quote lists missing kinds; balance needs key', async () => {
    const p = await createProject({ name: 'Q', brief: '' });
    let r = await api(`/api/projects/${p.id}/quote`, { items: [{ kind: 'image', params: {} }] });
    expect(await r.json()).toEqual({ usd: 0, missing: ['image'] });
    r = await api('/api/bot/balance');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'no_bot_key' });

    await saveConfig({ providers: { video: { use: 'bot' } }, botKey: 'testkey', botUrl: bot.url });
    r = await api(`/api/projects/${p.id}/quote`, {
      items: [{ kind: 'video', params: {} }, { kind: 'video', params: {} }, { kind: 'tts', params: {} }],
    });
    expect(await r.json()).toEqual({ usd: 0.8, missing: ['tts'] });
    expect(await (await api('/api/bot/balance')).json()).toEqual({ usd: 7 });
    expect((await api(`/api/projects/${p.id}/quote`, { items: [{ kind: 'nope' }] })).status).toBe(400);
  });

  test('non-https bot url is refused', async () => {
    const p = await createProject({ name: 'U', brief: '' });
    await saveConfig({ providers: { video: { use: 'bot' } }, botKey: 'testkey', botUrl: 'http://evil.example.com' });
    const r = await api('/api/bot/balance');
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'bad_bot_url' });
    const q = await api(`/api/projects/${p.id}/quote`, { items: [{ kind: 'video', params: {} }] });
    expect(await q.json()).toEqual({ usd: 0, missing: ['video'] });
  });
});
