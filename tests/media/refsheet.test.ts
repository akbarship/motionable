import { execFile } from 'node:child_process';
import { vi } from 'vitest';
vi.setConfig({ testTimeout: 60_000 }); // ffmpeg-heavy: real encodes take several seconds under parallel load
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
  expect(r.frameFiles.length).toBe(r.frames.length);
  expect(j.frameFiles).toEqual(r.frameFiles);
  expect(r.frameFiles[0]).toMatch(/^frames\/f-\d{3}\.\d\.jpg$/);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', join(out, r.frameFiles[0])]);
  expect(Number(stdout.trim())).toBe(768);
});

const slowClip = async (name: string, d: number) => {
  const clip = join(tmp, name);
  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=0xF4F1EA:s=320x568:r=30:d=${d}`,
    '-f', 'lavfi', '-i', 'color=c=0xC9643F:s=40x40:r=30',
    '-filter_complex', "[0:v][1:v]overlay=x='10+t*6':y='20+t*10':shortest=1,format=yuv420p[v]",
    '-map', '[v]', clip,
  ]);
  return clip;
};

test('refsheet samples by time when there are no hard cuts', async () => {
  const clip = await slowClip('slow.mp4', 40);
  const out = join(tmp, 'slow.sheet');
  const r = await buildRefSheet(clip, out);
  expect(r.cuts.length).toBe(0);
  expect(r.frames.length).toBeGreaterThanOrEqual(10);
  expect(r.sheets.length).toBeGreaterThanOrEqual(1);
  for (const t of r.frames) expect(t).toBeLessThan(40);
  const j = JSON.parse(await readFile(join(out, 'cuts.json'), 'utf8'));
  expect(j.frames).toEqual(r.frames);
});

test('last sheet is sized to its remaining frames (no black padding)', async () => {
  const clip = await slowClip('slow39.mp4', 39);
  const r = await buildRefSheet(clip, join(tmp, 'slow39.sheet'));
  const n = r.frames.length;
  expect(n).toBeGreaterThan(12);
  expect(n % 12).not.toBe(0);
  expect(r.sheets.length).toBe(Math.ceil(n / 12));
  const size = async (f: string) => {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]);
    const [w, h] = stdout.trim().split(',').map(Number);
    return { w, h };
  };
  const first = await size(r.sheets[0]);
  expect(first.w).toBe(1536);
  const tileH = first.h / 3;
  const rem = n - 12 * (r.sheets.length - 1);
  const last = await size(r.sheets[r.sheets.length - 1]);
  expect(last.w).toBe(Math.min(4, rem) * 384);
  expect(last.h).toBe(Math.ceil(rem / 4) * tileH);
});
