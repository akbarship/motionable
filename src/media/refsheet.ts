import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { writeJson } from '../core/store.js';
import { probe } from './ingest.js';

const run = promisify(execFile);
const MAX_FRAMES = 36;
const PER_SHEET = 12;
const TILE_W = 384; // 4 columns * 384 = 1536
const BUF = 64 * 1024 * 1024;

const CutsSchema = z.object({ cuts: z.array(z.number()), avgShot: z.number(), duration: z.number() });

export interface RefSheet {
  cuts: number[];
  sheets: string[];
  avgShot: number;
}

async function detectCuts(video: string): Promise<number[]> {
  const { stderr } = await run(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', video, '-an', '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'],
    { maxBuffer: BUF },
  );
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) out.push(Number(m[1]));
  return out;
}

/** Detects cuts, grabs one mid-shot frame per shot and tiles them into contact sheets. */
export async function buildRefSheet(video: string, outDir: string): Promise<RefSheet> {
  await mkdir(outDir, { recursive: true });
  const { duration } = await probe(video);
  const cuts = (await detectCuts(video)).filter((t) => t > 0 && t < duration);
  const bounds = [0, ...cuts, duration];
  let mids = bounds.slice(0, -1).map((b, i) => (b + bounds[i + 1]) / 2);
  if (mids.length > MAX_FRAMES) {
    mids = Array.from({ length: MAX_FRAMES }, (_, i) => mids[Math.floor((i * mids.length) / MAX_FRAMES)]);
  }
  const work = await mkdtemp(join(tmpdir(), 'motionable-frames-'));
  try {
    for (let i = 0; i < mids.length; i++) {
      await run(
        'ffmpeg',
        ['-v', 'error', '-y', '-ss', mids[i].toFixed(3), '-i', video, '-frames:v', '1', '-vf', `scale=${TILE_W}:-2`, join(work, `f${String(i + 1).padStart(3, '0')}.jpg`)],
        { maxBuffer: BUF },
      );
    }
    const sheets: string[] = [];
    for (let s = 0; s * PER_SHEET < mids.length; s++) {
      const file = join(outDir, `sheet-${s + 1}.jpg`);
      await run(
        'ffmpeg',
        ['-v', 'error', '-y', '-start_number', String(s * PER_SHEET + 1), '-i', join(work, 'f%03d.jpg'), '-vf', 'tile=4x3', '-frames:v', '1', file],
        { maxBuffer: BUF },
      );
      sheets.push(file);
    }
    const avgShot = duration / (cuts.length + 1);
    await writeJson(join(outDir, 'cuts.json'), CutsSchema, { cuts, avgShot, duration });
    return { cuts, sheets, avgShot };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
