import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigSchema, WordsSchema, type Config } from '../../src/core/types.js';
import { createBotProvider } from '../../src/providers/bot.js';
import { downloadResult } from '../../src/providers/download.js';
import { createElevenLabs } from '../../src/providers/elevenlabs.js';
import { createKie } from '../../src/providers/kie.js';
import { providerFor } from '../../src/providers/registry.js';
import { startMockBot, type MockBot } from './bot-mock.js';

const off = { use: 'off' as const };
const cfg = (over: Partial<Config> = {}): Config =>
  ConfigSchema.parse({ providers: { image: off, video: off, tts: off, stt: off }, ...over });
const FAST = { pollMs: 5, timeoutMs: 2000 };

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'motionable-prov-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmp, { recursive: true, force: true });
});

describe('registry', () => {
  test('defaults give null for every kind', () => {
    for (const k of ['image', 'video', 'tts', 'stt'] as const) expect(providerFor(k, cfg())).toBeNull();
  });
  test('invalid combos give null', () => {
    const c = cfg({ providers: { image: { use: 'elevenlabs', key: 'k' }, video: off, tts: { use: 'kie', key: 'k' }, stt: off } });
    expect(providerFor('image', c)).toBeNull();
    expect(providerFor('tts', c)).toBeNull();
  });
  test('valid combos and bot', () => {
    const c = cfg({ providers: { image: { use: 'kie', key: 'k' }, video: { use: 'bot' }, tts: off, stt: { use: 'elevenlabs', key: 'k' } }, botKey: 'b' });
    expect(providerFor('image', c)?.kinds).toContain('image');
    expect(providerFor('stt', c)?.kinds).toContain('stt');
    expect(providerFor('video', c)?.kinds).toEqual(['image', 'video', 'tts', 'stt']);
    expect(providerFor('video', cfg({ providers: { ...cfg().providers, video: { use: 'bot' } } }))).toBeNull(); // no botKey
  });
});

describe('bot adapter', () => {
  let bot: MockBot;
  afterEach(() => bot.close());

  test('quote, run, poll to done, download', async () => {
    bot = await startMockBot();
    const p = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, { ...FAST, allowInsecure: true });
    expect(await p.quote({ kind: 'video', params: { prompt: 'x' }, outDir: tmp })).toEqual({ usd: 0.4 });
    const r = await p.run({ kind: 'video', params: { prompt: 'x' }, outDir: tmp, taskId: 't1' });
    expect(r.usd).toBe(0.4);
    expect(r.file).toBe(join(tmp, 't1.mp4'));
    expect(await readFile(r.file, 'utf8')).toBe('FAKEVIDEO');
    expect((await readdir(tmp)).some((n) => n.endsWith('.part'))).toBe(false);
    expect(bot.calls.every((c) => c.path.startsWith('/files') || c.auth === 'Bearer testkey')).toBe(true);
  });

  test('402 maps to insufficient_balance', async () => {
    bot = await startMockBot({ failWith: 402 });
    const p = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, { ...FAST, allowInsecure: true });
    await expect(p.run({ kind: 'image', params: {}, outDir: tmp })).rejects.toThrow('insufficient_balance');
  });

  test('other status error has status and no key', async () => {
    bot = await startMockBot({ failWith: 500 });
    const p = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, { ...FAST, allowInsecure: true });
    const e = await p.quote({ kind: 'image', params: {}, outDir: tmp }).catch((x: Error) => x);
    expect((e as Error).message).toContain('500');
    expect((e as Error).message).not.toContain('testkey');
  });

  test('failed job throws, timeout throws', async () => {
    bot = await startMockBot({ jobError: 'bad prompt' });
    const p = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, { ...FAST, allowInsecure: true });
    await expect(p.run({ kind: 'image', params: {}, outDir: tmp })).rejects.toThrow('bad prompt');
    await bot.close();
    bot = await startMockBot({ pollsBeforeDone: 1e9 });
    const q = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, { pollMs: 5, timeoutMs: 60, allowInsecure: true });
    await expect(q.run({ kind: 'image', params: {}, outDir: tmp })).rejects.toThrow(/timed out/);
  });

  test('run sends taskId as Idempotency-Key and resumes a given job without a new run', async () => {
    bot = await startMockBot();
    const p = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, { ...FAST, allowInsecure: true });
    const ids: string[] = [];
    await p.run({ kind: 'image', params: {}, outDir: tmp, taskId: 'idem1', onJobId: (j) => void ids.push(j) });
    const runCall = bot.calls.find((c) => c.path === '/v1/run')!;
    expect(runCall.idem).toBe('idem1');
    expect(ids).toEqual(['job1']);
    const before = bot.calls.filter((c) => c.path === '/v1/run').length;
    await p.run({ kind: 'image', params: {}, outDir: tmp, taskId: 'idem2', resumeJobId: 'job1' });
    expect(bot.calls.filter((c) => c.path === '/v1/run').length).toBe(before);
  });

  test('rejects non-https bot url except localhost', () => {
    expect(() => createBotProvider({ botKey: 'k', botUrl: 'http://example.com' })).toThrow('bad_bot_url');
    expect(() => createBotProvider({ botKey: 'k', botUrl: 'http://localhost:9' })).not.toThrow();
    expect(providerFor('image', cfg({ providers: { ...cfg().providers, image: { use: 'bot' } }, botKey: 'b', botUrl: 'ftp://x' }))).toBeNull();
  });

  test('balance', async () => {
    bot = await startMockBot({ balance: 3 });
    const p = createBotProvider({ botKey: 'testkey', botUrl: bot.url }, FAST);
    expect(await p.balance()).toEqual({ usd: 3 });
  });
});

describe('download', () => {
  test('rejects http, bad ext, oversize', async () => {
    await expect(downloadResult('http://x.test/a.mp4', tmp, 't')).rejects.toThrow(/https/);
    vi.stubGlobal('fetch', async () => new Response('x', { headers: { 'content-type': 'application/zip' } }));
    await expect(downloadResult('https://x.test/a.zip', tmp, 't')).rejects.toThrow(/type/);
    vi.stubGlobal('fetch', async () => new Response('x', { headers: { 'content-type': 'video/mp4', 'content-length': String(600 * 1024 ** 2) } }));
    await expect(downloadResult('https://x.test/a.mp4', tmp, 't')).rejects.toThrow(/large/);
  });
  test('refuses https to http redirect, follows https redirect, caps hops', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 302, headers: { location: 'http://evil.test/a.mp4' } }));
    await expect(downloadResult('https://x.test/a.mp4', tmp, 't')).rejects.toThrow(/https/);
    vi.stubGlobal('fetch', async (u: string) =>
      u === 'https://x.test/a.mp4'
        ? new Response(null, { status: 302, headers: { location: '/b.mp4' } })
        : new Response('ok', { headers: { 'content-type': 'video/mp4' } }),
    );
    expect(await downloadResult('https://x.test/a.mp4', tmp, 'r')).toBe(join(tmp, 'r.mp4'));
    vi.stubGlobal('fetch', async () => new Response(null, { status: 302, headers: { location: 'https://x.test/loop.mp4' } }));
    await expect(downloadResult('https://x.test/a.mp4', tmp, 'l')).rejects.toThrow(/redirect/);
  });
  test('ext from url when content-type is generic', async () => {
    vi.stubGlobal('fetch', async () => new Response('png', { headers: { 'content-type': 'application/octet-stream' } }));
    expect(await downloadResult('https://x.test/a/b.png?sig=1', tmp, 'tk')).toBe(join(tmp, 'tk.png'));
  });
});

describe('elevenlabs', () => {
  test('stt maps response to words.json shape', async () => {
    const seen: { url: string; key: string | null }[] = [];
    vi.stubGlobal('fetch', async (u: string, init: RequestInit) => {
      seen.push({ url: u, key: new Headers(init.headers).get('xi-api-key') });
      return Response.json({
        words: [
          { text: 'Salom', start: 0.1, end: 0.5, type: 'word' },
          { text: ' ', start: 0.5, end: 0.6, type: 'spacing' },
          { text: 'dunyo', start: 0.6, end: 1, type: 'word' },
          { text: '(laughter)', start: 1, end: 1.2, type: 'audio_event' },
        ],
      });
    });
    const p = createElevenLabs({ stt: 'k1', tts: undefined });
    await writeFile(join(tmp, 'a.mp3'), 'audio');
    const words = await p.transcribe(join(tmp, 'a.mp3'));
    expect(WordsSchema.parse(words)).toEqual([
      { w: 'Salom', start: 0.1, end: 0.5 },
      { w: 'dunyo', start: 0.6, end: 1 },
    ]);
    expect(seen[0].url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(seen[0].key).toBe('k1');
  });
  test('tts writes mp3 and quotes from prices', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('ID3'), { headers: { 'content-type': 'audio/mpeg' } }));
    const p = createElevenLabs({ tts: 'k', stt: undefined });
    const req = { kind: 'tts' as const, params: { text: 'a'.repeat(2000), voiceId: 'v1' }, outDir: tmp, taskId: 'tt' };
    expect((await p.quote(req)).usd).toBeGreaterThan(0);
    const r = await p.run(req);
    expect(r.file).toBe(join(tmp, 'tt.mp3'));
    expect(await readFile(r.file, 'utf8')).toBe('ID3');
  });
  test('http error hides key', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad', { status: 401 }));
    const p = createElevenLabs({ tts: 'SECRETKEY', stt: undefined });
    const e = await p.run({ kind: 'tts', params: { text: 'hi', voiceId: 'v' }, outDir: tmp }).catch((x: Error) => x);
    expect((e as Error).message).toContain('401');
    expect((e as Error).message).not.toContain('SECRETKEY');
  });
});

describe('kie', () => {
  test('image: createTask then poll recordInfo then download', async () => {
    const urls: string[] = [];
    let n = 0;
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.endsWith('/createTask')) {
        expect(JSON.parse(init!.body as string).model).toBe('nano-banana-2');
        return Response.json({ code: 200, data: { taskId: 'kt1' } });
      }
      if (u.includes('/recordInfo')) {
        n += 1;
        return Response.json({ code: 200, data: n < 2 ? { state: 'generating' } : { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/o.png'] }) } });
      }
      return new Response('PNG', { headers: { 'content-type': 'image/png' } });
    });
    const p = createKie('k', FAST);
    const req = { kind: 'image' as const, params: { prompt: 'cat', model: 'nano-banana-2' }, outDir: tmp, taskId: 'ki' };
    expect((await p.quote(req)).usd).toBeGreaterThan(0);
    const r = await p.run(req);
    expect(r.file).toBe(join(tmp, 'ki.png'));
    expect(urls[0]).toBe('POST https://api.kie.ai/api/v1/jobs/createTask');
  });
  test('polling survives 5xx and network errors; resume skips createTask', async () => {
    let create = 0;
    let rec = 0;
    vi.stubGlobal('fetch', async (u: string) => {
      if (u.endsWith('/createTask')) {
        create += 1;
        return Response.json({ code: 200, data: { taskId: 'kt9' } });
      }
      if (u.includes('/recordInfo')) {
        rec += 1;
        if (rec === 1) return new Response('x', { status: 503 });
        if (rec === 2) throw new TypeError('fetch failed');
        return Response.json({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/o.png'] }) } });
      }
      return new Response('PNG', { headers: { 'content-type': 'image/png' } });
    });
    const ids: string[] = [];
    const r = await createKie('k', FAST).run({ kind: 'image', params: { prompt: 'p' }, outDir: tmp, taskId: 'rs', onJobId: (j) => void ids.push(j) });
    expect(r.file).toBe(join(tmp, 'rs.png'));
    expect([create, rec, ids]).toEqual([1, 3, ['kt9']]);
    await createKie('k', FAST).run({ kind: 'image', params: { prompt: 'p' }, outDir: tmp, taskId: 'rs2', resumeJobId: 'kt9' });
    expect(create).toBe(1);
  });
  test('failed task throws', async () => {
    vi.stubGlobal('fetch', async (u: string) =>
      u.endsWith('/createTask') ? Response.json({ code: 200, data: { taskId: 'x' } }) : Response.json({ code: 200, data: { state: 'fail', failMsg: 'nsfw' } }),
    );
    await expect(createKie('k', FAST).run({ kind: 'image', params: { prompt: 'p' }, outDir: tmp })).rejects.toThrow('nsfw');
  });
});
