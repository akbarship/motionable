// `look`: the one way Claude sees pictures (images only on request, rule 4). A project's or a reference's contact
// sheet, a strip of frames over a span, frames of the project's own edit, or a specimen: the project's footage in a
// style, built in a scratch copy so the project's own plan never changes.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import type {Batch} from '@motionable/plan';
import {HOME, commitBatch, loadJob, writeJson} from '@motionable/plan/store';
import {scaffold} from '@motionable/plan/scaffold';
import {frameStrip, nodeBin} from '@motionable/engine';
import {buildPage} from './build';
import {isVoiceover, readReport} from './analyze';
import {projectDir} from './projects';
import {referenceFile} from './styles';


export type LookArgs = {project?: string; style?: string; ref?: string; from?: number; to?: number; n?: number; ops?: Batch['ops']; plan?: boolean};
type Picture = {file: string; info: Record<string, unknown>};

const snapshot = (dir: string, times: number[], out: string) => new Promise<void>((resolve, reject) => {
  const [node, args] = nodeBin('hyperframes', ['snapshot', '--at', times.join(','), '--no-end', '--output', out]);
  const p = spawn(node, args, {cwd: dir, windowsHide: true, env: {...process.env, HYPERFRAMES_NO_TELEMETRY: '1'}});
  let err = '';
  p.stderr.on('data', (d) => (err = (err + d).slice(-1500)));
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`snapshot failed: ${err.slice(-400)}`))));
});

/** The project's footage in a style: scaffold a scratch copy, apply optional ops, snapshot the span. */
const specimen = async (project: string, style: string, from: number, to: number, n: number, ops: Batch['ops'] | undefined, home: string): Promise<Picture> => {
  const src = projectDir(project, home);
  const dir = path.join(home, '.cache', 'specimen', `${project}--${style.replace('@', '-')}`);
  fs.rmSync(dir, {recursive: true, force: true});
  fs.mkdirSync(dir, {recursive: true});
  for (const sub of ['input', 'analysis']) fs.symlinkSync(path.join(src, sub), path.join(dir, sub), 'junction'); // junction: no admin rights needed on Windows
  fs.copyFileSync(path.join(src, 'job.json'), path.join(dir, 'job.json'));
  const {plan} = scaffold(dir, style, home);
  if (ops?.length) {
    const job = loadJob(dir, home);
    commitBatch(job, {base: plan.version, by: {kind: 'mcp', tool: 'specimen'}, why: 'specimen', ops});
  }
  const {page, frames} = await buildPage(dir, home);
  const end = Math.min(to, frames / 30);
  const times = Array.from({length: n}, (_, i) => +(from + ((end - from) * (i + 0.5)) / n).toFixed(2));
  const out = path.join(dir, 'snap');
  await snapshot(page, times, out);
  writeJson(path.join(dir, 'specimen.json'), {project, style, times});
  return {file: path.join(out, 'contact-sheet.jpg'), info: {kind: 'specimen', style, times}};
};

/** The project's own edit: frames of its built page (the plan as it is now). */
const planFrames = async (project: string, from: number, to: number, n: number, home: string): Promise<Picture> => {
  const dir = projectDir(project, home);
  const {page, frames, version} = await buildPage(dir, home);
  const end = Math.min(to, frames / 30);
  const times = Array.from({length: n}, (_, i) => +(from + ((end - from) * (i + 0.5)) / n).toFixed(2));
  const out = path.join(dir, 'cache', 'plan-snap');
  fs.rmSync(out, {recursive: true, force: true});
  await snapshot(page, times, out);
  return {file: path.join(out, 'contact-sheet.jpg'), info: {kind: 'plan', version, times}};
};

export const look = async (a: LookArgs, home = HOME): Promise<Picture> => {
  const n = Math.max(2, Math.min(16, a.n ?? 12));
  const span = a.from !== undefined && a.to !== undefined && a.to > a.from;
  if (a.project && a.plan) return planFrames(a.project, a.from ?? 0, a.to ?? 6, Math.min(n, 8), home);
  if (a.project && a.style) return specimen(a.project, a.style, a.from ?? 0, a.to ?? 6, Math.min(n, 8), a.ops, home);
  if (a.style && a.ref) {
    const r = referenceFile(a.style.split('@')[0], a.ref, home);
    if (!span) return {file: r.sheet, info: {kind: 'sheet', columns: 8, tileSeconds: r.study.sheetTimes, cuts: r.study.cuts}};
    const file = path.join(path.dirname(r.sheet), `${a.ref}.strip.jpg`);
    return {file, info: {kind: 'strip', columns: 4, times: await frameStrip(r.file, file, a.from!, a.to!, n)}};
  }
  if (a.project) {
    const dir = projectDir(a.project, home);
    if (!span) {
      if (isVoiceover(dir)) throw new Error('a voiceover has no footage to look at: look {project, plan: true} shows the edit');
      const file = path.join(dir, 'analysis', 'contact.jpg');
      if (!fs.existsSync(file)) throw new Error('no contact sheet yet: the analysis is still running');
      return {file, info: {kind: 'sheet', columns: 8, tileSeconds: readReport(dir).sheetTimes ?? []}};
    }
    const file = path.join(dir, 'cache', 'strip.jpg');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    return {file, info: {kind: 'strip', columns: 4, times: await frameStrip(path.join(dir, 'input', 'source.mp4'), file, a.from!, a.to!, n)}};
  }
  throw new Error('look at a project, a style reference (style + ref), or a project in a style (project + style)');
};
