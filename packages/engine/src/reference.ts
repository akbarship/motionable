// A reference reel, measured: cuts (ffmpeg scene detection), pacing, and pictures Claude studies. Only the style is
// learned from a reference; its footage and words are never used. Node only.
import fs from 'node:fs';
import {ffmpeg, run} from './ffmpeg';
import {contactSheet, probeMedia} from './media';

const SCENE = 0.3; // ffmpeg scene score that counts as a cut

/** Cut times in seconds. */
export const sceneCuts = async (file: string) => {
  const err = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${SCENE})',showinfo`, '-f', 'null', '-'], {stderr: true});
  return [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => +Number(m[1]).toFixed(2));
};

/** Pacing in words: the same bands everywhere, so styles compare. */
const pacing = (avgShotS: number) => (avgShotS > 10 ? 'slow' : avgShotS > 5 ? 'calm' : avgShotS > 2 ? 'dynamic' : 'rapid');

export type ReferenceStudy = {
  file: string; durationS: number; w: number; h: number; fps: number;
  cuts: number[]; cutsPerMin: number; avgShotS: number; pacing: string; sheetTimes: number[]; // cuts: hard cuts only; soft wipes and moves are judged from the pictures
};

export const studyReference = async (file: string, sheet: string): Promise<ReferenceStudy> => {
  const info = await probeMedia(file);
  const cuts = await sceneCuts(file);
  const shots = cuts.length + 1;
  const avgShotS = +(info.duration / shots).toFixed(2);
  const sheetTimes = await contactSheet(file, sheet, info.duration);
  return {file: info.file, durationS: info.duration, w: info.video.w, h: info.video.h, fps: info.video.fps, cuts,
    cutsPerMin: +((cuts.length / info.duration) * 60).toFixed(1), avgShotS, pacing: pacing(avgShotS), sheetTimes};
};

/**
 * A strip of frames for a close look at motion: up to 16 frames evenly from `from` to `to`, 4 per row, 240 px wide
 * (enough to read type, easing and layout; about 1,500 tokens).
 */
export const frameStrip = async (file: string, out: string, from: number, to: number, n = 12) => {
  const count = Math.max(2, Math.min(16, n));
  const step = Math.max(1 / 30, (to - from) / count);
  const rows = Math.ceil(count / 4);
  fs.rmSync(out, {force: true});
  await ffmpeg(['-ss', String(from), '-i', file, '-t', String(step * count), '-vf', `fps=${1 / step},scale=240:-2,tile=4x${rows}:padding=3:color=black`,
    '-frames:v', '1', '-q:v', '6', out]);
  return Array.from({length: count}, (_, i) => +(from + i * step).toFixed(2));
};
