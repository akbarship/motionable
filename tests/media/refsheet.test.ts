import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { probe } from '../../src/media/ingest.js';
import { buildRefSheet } from '../../src/media/refsheet.js';

const run = promisify(execFile);
let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
});
afterAll(() => rm(tmp, { recursive: true, force: true }));

test('refsheet finds cuts in generated clip', async () => {
  const clip = join(tmp, 'clip.mp4');
  const src = (c: string, d: number) => ['-f', 'lavfi', '-i', `color=c=${c}:s=320x568:r=30:d=${d}`];
  await run('ffmpeg', [
    '-v', 'error', '-y',
    ...src('red', 2), ...src('blue', 2), ...src('green', 1),
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', clip,
  ]);
  const p = await probe(clip);
  expect(p.w).toBe(320);
  expect(p.fps).toBeCloseTo(30, 1);
  expect(p.hasAudio).toBe(false);
  const out = join(tmp, 'clip.sheet');
  const r = await buildRefSheet(clip, out);
  expect(r.cuts.length).toBe(2);
  expect(Math.abs(r.cuts[0] - 2)).toBeLessThan(0.2);
  expect(Math.abs(r.cuts[1] - 4)).toBeLessThan(0.2);
  expect(r.sheets.length).toBe(1);
  for (const s of r.sheets) await access(s);
  const j = JSON.parse(await readFile(join(out, 'cuts.json'), 'utf8'));
  expect(j.cuts).toEqual(r.cuts);
  expect(r.avgShot).toBeCloseTo(5 / 3, 1);
});
