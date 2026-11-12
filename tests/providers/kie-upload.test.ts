import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createKie, NO_TEXT, REF_PROMPT } from '../../src/providers/kie.js';
import { UPLOAD_URL, uploadRef } from '../../src/providers/kie-upload.js';

const FAST = { pollMs: 5, timeoutMs: 2000 };
let homeDir: string;
let proj: string;
let oldHome: string | undefined;
let uploads: { url: string; init: RequestInit }[];
let created: { model: string; input: Record<string, unknown> }[];

beforeEach(async () => {
  oldHome = process.env.MOTIONABLE_HOME;
  homeDir = await mkdtemp(join(tmpdir(), 'motionable-ref-'));
  process.env.MOTIONABLE_HOME = homeDir;
  proj = join(homeDir, 'projects', 'p1');
  await mkdir(join(proj, 'gen', 'ref'), { recursive: true });
  await writeFile(join(proj, 'gen', 'ref', 'a.jpg'), 'AAA');
  await writeFile(join(proj, 'gen', 'ref', 'b.png'), 'BBB');
  uploads = [];
  created = [];
  let n = 0;
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    if (u === UPLOAD_URL) {
      uploads.push({ url: u, init: init! });
      n += 1;
      return Response.json({ success: true, code: 200, msg: 'ok', data: { downloadUrl: `https://tempfile.redpandaai.co/u${n}.jpg` } });
    }
    if (u.endsWith('/createTask')) {
      created.push(JSON.parse(init!.body as string));
      return Response.json({ code: 200, data: { taskId: 't' } });
    }
    return Response.json({ code: 200, data: { state: 'fail', failMsg: 'stop' } });
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  if (oldHome === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = oldHome;
  await rm(homeDir, { recursive: true, force: true });
});

const a = () => join(proj, 'gen', 'ref', 'a.jpg');

describe('uploadRef', () => {
  test('request shape and returned url', async () => {
    const url = await uploadRef('KEY', a());
    expect(url).toBe('https://tempfile.redpandaai.co/u1.jpg');
    const { init } = uploads[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer KEY');
    const f = init.body as FormData;
    expect(f.get('uploadPath')).toBe('motionable/refs');
    expect(String(f.get('fileName'))).toMatch(/\.jpg$/);
    expect(await (f.get('file') as Blob).text()).toBe('AAA');
  });
  test('cache hit skips upload; expiry re-uploads', async () => {
    let t = 1_000_000;
    const o = { projectDir: proj, now: () => t };
    const u1 = await uploadRef('k', a(), o);
    expect(await uploadRef('k', a(), o)).toBe(u1);
    expect(uploads).toHaveLength(1);
    expect(Object.keys(JSON.parse(await readFile(join(proj, 'gen', 'ref-urls.json'), 'utf8')))).toHaveLength(1);
    t += 23.5 * 3_600_000; // inside the safety margin
    expect(await uploadRef('k', a(), o)).not.toBe(u1);
    expect(uploads).toHaveLength(2);
  });
  test('rejects outside home and bad extension', async () => {
    const out = await mkdtemp(join(tmpdir(), 'motionable-out-'));
    await writeFile(join(out, 'x.jpg'), 'x');
    await expect(uploadRef('k', join(out, 'x.jpg'))).rejects.toThrow(/outside/);
    await rm(out, { recursive: true, force: true });
    await writeFile(join(proj, 'gen', 'ref', 'c.gif'), 'x');
    await expect(uploadRef('k', join(proj, 'gen', 'ref', 'c.gif'))).rejects.toThrow(/jpg, png or webp/);
    expect(uploads).toHaveLength(0);
  });
  test('api error body throws', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ code: 401, msg: 'bad key' }));
    await expect(uploadRef('k', a())).rejects.toThrow(/401/);
  });
});

describe('kie run with refFrames', () => {
  const run = (params: Record<string, unknown>, kind: 'image' | 'video' = 'image', projectDir: string | null = proj) =>
    createKie('k', FAST).run({ kind, params: { prompt: 'cat', ...params }, outDir: join(proj, 'gen'), projectDir: projectDir ?? undefined }).catch(() => {});
  const refs = ['gen/ref/a.jpg', 'gen/ref/b.png'];

  test('nano-banana-2 uses image_urls and prefixes prompt', async () => {
    await run({ model: 'nano-banana-2', refFrames: refs });
    expect(uploads).toHaveLength(2);
    expect(created[0].input.image_urls).toHaveLength(2);
    expect(created[0].input.prompt).toBe(`${REF_PROMPT} cat ${NO_TEXT}`);
  });
  test('no-text line is not duplicated', async () => {
    await run({ model: 'nano-banana-2', refFrames: refs, prompt: `cat. ${NO_TEXT}` });
    expect(created[0].input.prompt).toBe(`${REF_PROMPT} cat. ${NO_TEXT}`);
  });
  test('nano-banana-pro uses image_input', async () => {
    await run({ model: 'nano-banana-pro', refFrames: refs });
    expect(created[0].input.image_input).toHaveLength(2);
    expect(created[0].input.image_urls).toBeUndefined();
  });
  test('kling uses image_urls; veo ignores refFrames', async () => {
    await run({ model: 'kling', refFrames: refs }, 'video');
    expect(created[0].input.image_urls).toHaveLength(2);
    uploads.length = 0;
    await run({ model: 'veo3_fast', refFrames: refs }, 'video');
    expect(uploads).toHaveLength(0);
    expect(created[1].input.image_urls).toBeUndefined();
    expect(created[1].input.prompt).toBe('cat');
  });
  test('max 4 refs; repeated gen reuses cache', async () => {
    await run({ refFrames: [...refs, ...refs, 'gen/ref/a.jpg'] });
    expect(created[0].input.image_urls).toHaveLength(4);
    expect(uploads).toHaveLength(2);
  });
  test('refs escaping the project are rejected before any request', async () => {
    await run({ refFrames: ['../../x.jpg'] });
    await run({ refFrames: ['/etc/passwd'] });
    await run({ refFrames: refs }, 'image', null);
    expect(uploads).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
  test('quote never uploads', async () => {
    await createKie('k', FAST).quote({ kind: 'image', params: { prompt: 'p', refFrames: refs }, outDir: proj, projectDir: proj });
    expect(uploads).toHaveLength(0);
  });
});
