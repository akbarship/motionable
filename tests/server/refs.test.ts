import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { projectDir } from '../../src/core/paths.js';
import { startStudio } from '../../src/server/studio.js';

const run = promisify(execFile);
let tmp: string, base: string, token: string, close: () => Promise<void>, prevHome: string | undefined, prevPath: string | undefined;

beforeEach(async () => {
  prevHome = process.env.MOTIONABLE_HOME;
  prevPath = process.env.PATH;
  tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
  process.env.MOTIONABLE_HOME = tmp;
  const staticDir = join(tmp, 'static');
  await mkdir(staticDir);
  await writeFile(join(staticDir, 'index.html'), 'x');
  const s = await startStudio({ port: 0, staticDir });
  close = s.close;
  base = new URL(s.url).origin;
  token = new URL(s.url).searchParams.get('t')!;
});
afterEach(async () => {
  await close();
  process.env.PATH = prevPath;
  if (prevHome === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prevHome;
  await rm(tmp, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'x-motionable-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
async function mk(): Promise<string> {
  return ((await (await post('/api/projects', { name: 'Demo', brief: 'b' })).json()) as { id: string }).id;
}
async function clip(dest: string) {
  await mkdir(join(dest, '..'), { recursive: true });
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x568:r=30:d=2', '-pix_fmt', 'yuv420p', dest]);
}

test('refs/file builds sheet and queues study_ref', async () => {
  const id = await mk();
  await clip(join(projectDir(id), 'refs', 'a.mp4'));
  const r = await post(`/api/projects/${id}/refs/file`, { name: 'a.mp4' });
  expect(r.status).toBe(201);
  const { task } = (await r.json()) as { task: { type: string; input: unknown } };
  expect(task.type).toBe('study_ref');
  expect(task.input).toEqual({ video: 'refs/a.mp4', sheetDir: 'refs/a.sheet' });
  expect((await post(`/api/projects/${id}/refs/file`, { name: 'nope.mp4' })).status).toBe(404);
  expect((await post(`/api/projects/${id}/refs/file`, { name: '../a.mp4' })).status).toBe(400);
});

test('refs url: 400 bad, 502 on failed download, 201 on success', async () => {
  const id = await mk();
  expect((await post(`/api/projects/${id}/refs`, { url: 'file:///x' })).status).toBe(400);
  const bin = join(tmp, 'bin');
  await mkdir(bin);
  const src = join(tmp, 'src.mp4');
  await clip(src);
  process.env.PATH = `${bin}:${prevPath}`;
  await writeFile(join(bin, 'yt-dlp'), '#!/bin/sh\nexit 1\n');
  await chmod(join(bin, 'yt-dlp'), 0o755);
  const bad = await post(`/api/projects/${id}/refs`, { url: 'https://example.com/v' });
  expect(bad.status).toBe(502);
  expect(await bad.json()).toEqual({ error: 'Faylni yuklang' });
  await writeFile(
    join(bin, 'yt-dlp'),
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then T="$2"; fi; shift; done\nF=$(echo "$T" | sed 's/%(id)s/vid/; s/%(ext)s/mp4/')\ncp ${src} "$F"\necho "$F"\n`,
  );
  const ok = await post(`/api/projects/${id}/refs`, { url: 'https://www.instagram.com/reel/A/?igsh=1' });
  expect(ok.status).toBe(201);
  expect(((await ok.json()) as { task: { input: unknown } }).task.input).toEqual({ video: 'refs/vid.mp4', sheetDir: 'refs/vid.sheet' });
});
