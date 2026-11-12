import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { projectDir } from '../../src/core/paths.js';
import { startStudio } from '../../src/server/studio.js';
import { ensurePreview, stopAllPreviews } from '../../src/server/preview.js';
import { HttpError } from '../../src/server/upload.js';

let tmp: string;
const prev = { home: process.env.MOTIONABLE_HOME, bin: process.env.MOTIONABLE_HF_BIN };

async function fakeBin(): Promise<string> {
  const f = join(tmp, 'fake-hf.sh');
  // Logs each spawn (with pid) then prints a URL and stays alive like a dev server.
  await writeFile(
    f,
    `#!/bin/sh\necho "$$ $@" >> "${tmp}/spawns.log"\necho "Studio ready at http://127.0.0.1:4599/#project/x"\nexec sleep 60\n`,
  );
  await chmod(f, 0o755);
  return f;
}
const spawns = async () => (await readFile(join(tmp, 'spawns.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
const makeComp = async (id: string) => {
  await mkdir(join(projectDir(id), 'comp'), { recursive: true });
  await writeFile(join(projectDir(id), 'comp', 'index.html'), '<html></html>');
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'motionable-pv-'));
  process.env.MOTIONABLE_HOME = tmp;
  process.env.MOTIONABLE_HF_BIN = await fakeBin();
});
afterEach(async () => {
  await stopAllPreviews();
  for (const [k, v] of [['MOTIONABLE_HOME', prev.home], ['MOTIONABLE_HF_BIN', prev.bin]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe('ensurePreview', () => {
  test('returns parsed URL and reuses the child', async () => {
    await makeComp('p1');
    const [a, b] = await Promise.all([ensurePreview('p1'), ensurePreview('p1')]);
    expect(a.url).toBe('http://127.0.0.1:4599/#project/x');
    expect(b.url).toBe(a.url);
    expect((await ensurePreview('p1')).url).toBe(a.url);
    const log = await spawns();
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('preview');
  });

  test('missing comp -> 409 no_comp', async () => {
    await mkdir(projectDir('p2'), { recursive: true });
    await expect(ensurePreview('p2')).rejects.toMatchObject({ status: 409, message: 'no_comp' });
    await mkdir(join(projectDir('p2'), 'comp'));
    await expect(ensurePreview('p2')).rejects.toBeInstanceOf(HttpError);
  });

  test('child killed on stopAllPreviews and on studio close', async () => {
    await makeComp('p3');
    await ensurePreview('p3');
    const pid = Number((await spawns())[0].split(' ')[0]);
    expect(alive(pid)).toBe(true);
    await stopAllPreviews();
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(pid)).toBe(false);

    const s = await startStudio({ port: 0, staticDir: tmp });
    await makeComp('p4');
    const token = new URL(s.url).searchParams.get('t')!;
    const res = await fetch(`${new URL(s.url).origin}/api/projects/p4/preview`, { headers: { 'x-motionable-token': token } });
    expect(res.status).toBe(200);
    const pid2 = Number((await spawns())[1].split(' ')[0]);
    expect(alive(pid2)).toBe(true);
    await s.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(alive(pid2)).toBe(false);
  });
});

describe('renders routes', () => {
  let s: Awaited<ReturnType<typeof startStudio>>;
  let base: string;
  let H: Record<string, string>;
  beforeEach(async () => {
    s = await startStudio({ port: 0, staticDir: tmp });
    base = new URL(s.url).origin;
    H = { 'x-motionable-token': new URL(s.url).searchParams.get('t')! };
    await mkdir(join(projectDir('r1'), 'renders'), { recursive: true });
    const d = join(projectDir('r1'), 'renders');
    await writeFile(join(d, 'old.mp4'), '0123456789');
    await writeFile(join(d, 'new.mp4'), 'abcdefghij');
    await writeFile(join(d, 'note.txt'), 'x');
    await utimes(join(d, 'old.mp4'), new Date(1000), new Date(1000));
  });
  afterEach(async () => s.close());

  test('list: mp4 only, newest first', async () => {
    const res = await fetch(`${base}/api/projects/r1/renders`, { headers: H });
    const list = (await res.json()) as { name: string; size: number; mtime: string }[];
    expect(list.map((r) => r.name)).toEqual(['new.mp4', 'old.mp4']);
    expect(list[0].size).toBe(10);
  });

  test('list empty without renders dir', async () => {
    const res = await fetch(`${base}/api/projects/nope/renders`, { headers: H });
    expect(await res.json()).toEqual([]);
  });

  test('full file and 206 range', async () => {
    const full = await fetch(`${base}/api/projects/r1/renders/new.mp4`, { headers: H });
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(await full.text()).toBe('abcdefghij');
    const r = await fetch(`${base}/api/projects/r1/renders/new.mp4`, { headers: { ...H, range: 'bytes=2-4' } });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await r.text()).toBe('cde');
    const tail = await fetch(`${base}/api/projects/r1/renders/new.mp4`, { headers: { ...H, range: 'bytes=7-' } });
    expect(await tail.text()).toBe('hij');
  });

  test('416 on bad range', async () => {
    const r = await fetch(`${base}/api/projects/r1/renders/new.mp4`, { headers: { ...H, range: 'bytes=50-60' } });
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe('bytes */10');
    const g = await fetch(`${base}/api/projects/r1/renders/new.mp4`, { headers: { ...H, range: 'bytes=5-2' } });
    expect(g.status).toBe(416);
  });

  test('token via ?t= works', async () => {
    const res = await fetch(`${base}/api/projects/r1/renders/new.mp4?t=${H['x-motionable-token']}`);
    expect(res.status).toBe(200);
  });

  test('traversal and bad names 400, missing 404', async () => {
    for (const n of ['..%2F..%2Fsecret.mp4', '%2e%2e%2fx.mp4', 'a%5Cb.mp4', 'note.txt']) {
      const res = await fetch(`${base}/api/projects/r1/renders/${n}`, { headers: H });
      expect(res.status, n).toBe(400);
    }
    expect((await fetch(`${base}/api/projects/r1/renders/ghost.mp4`, { headers: H })).status).toBe(404);
  });
});
