import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { writeJson } from '../core/store.js';
import { probe } from './ingest.js';

const run = promisify(execFile);
const MAX_FRAMES = 36;
const PER_SHEET = 12;
const COLS = 4;
const TILE_W = 384; // 4 columns * 384 = 1536
const BUF = 64 * 1024 * 1024;

const CutsSchema = z.object({
  cuts: z.array(z.number()),
  avgShot: z.number(),
  duration: z.number(),
  frames: z.array(z.number()),
});

export interface RefSheet {
  cuts: number[];
  sheets: string[];
  avgShot: number;
  frames: number[];
}

const SCENE_THRESHOLD = 0.15;
const MIN_GAP = 0.75;
const FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
];

async function findFont(): Promise<string | undefined> {
  for (const f of FONT_CANDIDATES) {
    try {
      await access(f);
      return f;
    } catch {
      // try next
    }
  }
  return undefined;
}

/** Escapes a value for use inside a drawtext option (backslash, colon, quote). */
function escapeDrawtext(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function detectCuts(video: string): Promise<number[]> {
  const { stderr } = await run(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', video, '-an', '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-'],
    { maxBuffer: BUF },
  );
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9.]+)/g)) out.push(Number(m[1]));
  return out;
}

/** Shot midpoints plus uniform time samples, de-duplicated, sorted, capped at MAX_FRAMES. */
export function pickFrames(cuts: number[], duration: number): number[] {
  const bounds = [0, ...cuts, duration];
  const mids = bounds.slice(0, -1).map((b, i) => (b + bounds[i + 1]) / 2);
  const step = Math.max(3, duration / MAX_FRAMES);
  const uniform: number[] = [];
  for (let t = 0; t < duration; t += step) uniform.push(t);
  const maxT = Math.max(0, duration - 0.05);
  const chosen: number[] = [];
  for (const raw of [...mids, ...uniform]) {
    const t = Math.min(Math.max(raw, 0), maxT);
    if (chosen.every((c) => Math.abs(c - t) >= MIN_GAP)) chosen.push(t);
  }
  chosen.sort((a, b) => a - b);
  if (chosen.length <= MAX_FRAMES) return chosen;
  return Array.from({ length: MAX_FRAMES }, (_, i) => chosen[Math.floor((i * chosen.length) / MAX_FRAMES)]);
}

async function grabFrame(video: string, t: number, file: string, font: string | undefined, label: boolean): Promise<boolean> {
  let vf = `scale=${TILE_W}:-2`;
  if (label) {
    const fontOpt = font ? `fontfile='${escapeDrawtext(font)}':` : '';
    vf += `,drawtext=${fontOpt}text='${escapeDrawtext(`${t.toFixed(1)}s`)}':x=6:y=h-th-6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`;
  }
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', vf, file], { maxBuffer: BUF });
    return true;
  } catch (e) {
    if (!label) throw e;
    return false;
  }
}

/** Detects cuts, samples frames by shot and by time, tiles them into labelled contact sheets. */
export async function buildRefSheet(video: string, outDir: string): Promise<RefSheet> {
  await mkdir(outDir, { recursive: true });
  const { duration } = await probe(video);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('video has no valid duration');
  const cuts = (await detectCuts(video)).filter((t) => t > 0 && t < duration);
  const frames = pickFrames(cuts, duration);
  const font = await findFont();
  const work = await mkdtemp(join(tmpdir(), 'motionable-frames-'));
  try {
    let label = font !== undefined;
    for (let i = 0; i < frames.length; i++) {
      const file = join(work, `f${String(i + 1).padStart(3, '0')}.jpg`);
      if (label && !(await grabFrame(video, frames[i], file, font, true))) label = false;
      if (!label) await grabFrame(video, frames[i], file, font, false);
    }
    const sheets: string[] = [];
    for (let s = 0; s * PER_SHEET < frames.length; s++) {
      const n = Math.min(PER_SHEET, frames.length - s * PER_SHEET);
      const cols = n < COLS ? n : COLS;
      const rows = Math.ceil(n / COLS);
      const file = join(outDir, `sheet-${s + 1}.jpg`);
      await run(
        'ffmpeg',
        ['-v', 'error', '-y', '-start_number', String(s * PER_SHEET + 1), '-i', join(work, 'f%03d.jpg'), '-vf', `tile=${cols}x${rows}`, '-frames:v', '1', file],
        { maxBuffer: BUF },
      );
      sheets.push(file);
    }
    const avgShot = duration / (cuts.length + 1);
    await writeJson(join(outDir, 'cuts.json'), CutsSchema, { cuts, avgShot, duration, frames });
    return { cuts, sheets, avgShot, frames };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
