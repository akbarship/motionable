import { execFile, spawn } from 'node:child_process';
import { access, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { ZodType } from 'zod';
import { doctorReportOk, npxCommand, validateHfArgs } from './core/hf-cmd.js';
import { appendBinDir } from './core/path-env.js';
import { assertId, assertInHome, home } from './core/paths.js';
import { CutSchema, PlanSchema, ProjectSchema, WordsSchema as WordsList, StoryboardSchema, StyleSchema, WordsSchema, planStyleIssues, type Plan, type Style } from './core/types.js';
import { alignScript } from './media/align.js';
import { assemble } from './media/assemble.js';
import { decodePcm, findHits, findSilences } from './media/audio.js';
import { probe } from './media/ingest.js';
import { coloursInDir, extractColours, paletteOffenders, type Offender } from './media/palette.js';
import { buildRefSheet, type RefSheet } from './media/refsheet.js';
import { startStudio } from './server/studio.js';

const run = promisify(execFile);

/** True when `cmd args` exits 0. Never uses a shell. */
async function works(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args, { timeout: 60_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** True when `hyperframes doctor --json` runs and reports ok. Fixed literal args only (win32 uses a shell). */
async function hyperframesOk(): Promise<boolean> {
  const c = npxCommand(process.platform, ['--no-install', 'hyperframes', 'doctor', '--json']);
  try {
    const r = await run(c.cmd, c.args, { timeout: 60_000, shell: c.shell, windowsHide: true });
    return doctorReportOk(String(r.stdout), true);
  } catch (e) {
    // a non-zero exit may still carry a report; it can only say "not ok" here
    return doctorReportOk(String((e as { stdout?: unknown }).stdout ?? ''), false);
  }
}

export const nodeOk = (version: string): boolean => Number(version.replace(/^v/, '').split('.')[0]) >= 22;

const HF_SKILLS = ['hyperframes', 'hyperframes-cli', 'hyperframes-registry'];

/** Names of HyperFrames skills missing from `<claudeDir>/skills`. Informational only. */
export async function missingSkills(claudeDir: string = join(homedir(), '.claude')): Promise<string[]> {
  const gone: string[] = [];
  for (const n of HF_SKILLS) {
    try {
      await access(join(claudeDir, 'skills', n));
    } catch {
      gone.push(n);
    }
  }
  return gone;
}

export async function doctor() {
  const node = nodeOk(process.versions.node);
  const [ffmpeg, ytdlp, hyperframes] = await Promise.all([
    works('ffmpeg', ['-version']),
    works('yt-dlp', ['--version']),
    hyperframesOk(),
  ]);
  const skillsMissing = await missingSkills();
  return { ok: node && ffmpeg && hyperframes, node, ffmpeg, ytdlp, hyperframes, skillsMissing };
}

const SCHEMAS: Record<string, ZodType> = { style: StyleSchema, plan: PlanSchema, words: WordsSchema, storyboard: StoryboardSchema, cut: CutSchema };
const MAX_ISSUES = 8;

/** `motionable validate <style|plan|words|storyboard> <file>`: code 0 + "ok", or 1 + a short issue list. */
/** The plan's styles from <home>/styles/<id>/style.json; unreadable ones are skipped. */
async function readStyles(ids: string[]): Promise<Style[]> {
  const out: Style[] = [];
  for (const id of ids) {
    try {
      const r = StyleSchema.safeParse(JSON.parse(await readFile(join(home(), 'styles', assertId(id), 'style.json'), 'utf8')));
      if (r.success) out.push(r.data);
    } catch {
      // missing or bad style: the default rules apply
    }
  }
  return out;
}

export async function runValidate(kind: string | undefined, file: string | undefined): Promise<{ code: number; out: string }> {
  const schema = kind ? SCHEMAS[kind] : undefined;
  if (!schema || !file) return { code: 1, out: 'usage: motionable validate <style|plan|words|storyboard|cut> <file>' };
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return { code: 1, out: `cannot read JSON: ${(e as Error).message.split('\n')[0]}` };
  }
  const r = schema.safeParse(data);
  if (r.success && kind === 'plan') {
    const issues = planStyleIssues(r.data as Plan, await readStyles((r.data as Plan).styleIds));
    if (issues.length > 0) return { code: 1, out: issues.map((i) => `- ${i}`).join('\n') };
  }
  if (r.success) return { code: 0, out: 'ok' };
  const lines = r.error.issues.slice(0, MAX_ISSUES).map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`);
  const more = r.error.issues.length - lines.length;
  return { code: 1, out: [...lines, ...(more > 0 ? [`- ... ${more} more`] : [])].join('\n') };
}

/**
 * `palette-check <projectDir>`: every non-neutral colour in comp/ must sit near the allowed palette:
 * the user's own palette + accent (styleAnswers), else the reference's palette, background and recipe colours.
 */
export async function runPaletteCheck(projectDir: string): Promise<{ code: number; allowed: string[]; offenders: Offender[] }> {
  const dir = assertInHome(projectDir);
  const project = ProjectSchema.parse(JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')));
  let planStyles: string[] = [];
  try {
    planStyles = (JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8')) as Plan).styleIds ?? [];
  } catch {
    // no plan yet
  }
  const styles = await readStyles([...new Set([...project.styleIds, ...planStyles])]);
  const a = project.styleAnswers;
  const refColours = styles.flatMap((st) => [
    ...st.colour.palette,
    ...extractColours(JSON.stringify([st.background ?? null, st.materials ?? null, st.recipes ?? null])),
  ]);
  const allowed = new Set<string>();
  if (a && Array.isArray(a.palette)) {
    a.palette.forEach((c) => allowed.add(c.toLowerCase()));
    // An exact reference background keeps its own colours even with the user's palette.
    if (a.background === 'exact') styles.flatMap((st) => extractColours(JSON.stringify(st.background ?? null))).forEach((c) => allowed.add(c));
  } else refColours.forEach((c) => allowed.add(c.toLowerCase()));
  if (a?.accent) allowed.add(a.accent.toLowerCase());
  const offenders = paletteOffenders(await coloursInDir(join(dir, 'comp')), [...allowed]);
  return { code: offenders.length > 0 ? 1 : 0, allowed: [...allowed], offenders };
}

/** A project-relative media path, resolved and kept inside the project. */
function inProject(dir: string, rel: string): string {
  const abs = assertInHome(join(dir, rel));
  if (!abs.startsWith(dir + sep)) throw new Error(`${rel} is outside the project`);
  return abs;
}

/**
 * `align <projectDir> <src>...`: every take of every script line (project brief) in the sources'
 * words (<base>.words.json beside each file), and the take to keep.
 */
export async function runAlign(projectDir: string, srcs: string[]) {
  const dir = assertInHome(projectDir);
  const project = ProjectSchema.parse(JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')));
  const sources = [];
  for (const src of srcs) {
    const abs = inProject(dir, src);
    const wordsFile = join(dirname(abs), `${basename(abs, extname(abs))}.words.json`);
    sources.push({ src, words: WordsList.parse(JSON.parse(await readFile(wordsFile, 'utf8'))) });
  }
  return alignScript(project.brief, sources).map((m) => ({
    line: m.line,
    pick: m.pick && { src: m.pick.src, start: m.pick.start, end: m.pick.end, coverage: m.pick.coverage },
    takes: m.takes.map((t) => ({ src: t.src, start: t.start, end: t.end, coverage: t.coverage })),
  }));
}

/** `assemble <projectDir>`: cut.json -> broll/body.(mp4|wav) + body.words.json; cut.json gets body and duration. */
export async function runAssemble(projectDir: string) {
  const dir = assertInHome(projectDir);
  const cutFile = join(dir, 'cut.json');
  const cut = CutSchema.parse(JSON.parse(await readFile(cutFile, 'utf8')));
  const outDir = join(dir, 'broll');
  await mkdir(outDir, { recursive: true });
  const r = await assemble(cut, (src) => inProject(dir, src), outDir);
  const bodyRel = relative(dir, r.body).split('\\').join('/');
  await writeFile(join(outDir, 'body.words.json'), JSON.stringify(r.words));
  // The written cut is what the body holds: snapped edges, long pauses split out.
  const next = { ...cut, segments: r.segments, body: bodyRel, duration: r.duration, approved: false };
  await writeFile(cutFile, JSON.stringify(next, null, 2));
  return { body: bodyRel, duration: r.duration, segments: r.segments.length, words: r.words.length };
}

/** `motionable sheet <video> <outDir>`: contact sheets + cuts.json; prints a small JSON summary. */
export async function runSheet(
  video: string,
  outDir: string,
  build: (v: string, o: string) => Promise<RefSheet> = buildRefSheet,
): Promise<string> {
  const r = await build(video, outDir);
  return JSON.stringify({ sheets: r.sheets, cuts: r.cuts.length, avgShot: r.avgShot });
}

/**
 * `copy-sheets <sheetDir> <styleId> [prefix]`: sheet-*.jpg into <home>/styles/<styleId>/sheets/, frames/*.jpg into .../frames/.
 * With several refs per style, `prefix` (e.g. r2) keeps their files apart: r2-sheet-1.jpg, r2-f-003.0.jpg.
 */
export async function runCopySheets(sheetDir: string, styleId: string, prefix?: string): Promise<{ copied: string[]; frames: string[] }> {
  if (prefix !== undefined && !/^[a-z0-9]{1,12}$/.test(prefix)) throw new Error('prefix must be 1-12 chars a-z0-9');
  const pre = prefix ? `${prefix}-` : '';
  const src = assertInHome(sheetDir);
  const dest = assertInHome(join(home(), 'styles', assertId(styleId), 'sheets'));
  const names = (await readdir(src)).filter((n) => /^sheet-.*\.jpg$/.test(n)).sort();
  await mkdir(dest, { recursive: true });
  for (const n of names) await copyFile(join(src, n), join(dest, pre + n));
  let frames: string[] = [];
  try {
    frames = (await readdir(join(src, 'frames'))).filter((n) => /\.jpg$/.test(n)).sort();
  } catch {
    // older sheets have no frames/
  }
  if (frames.length) {
    const fdest = assertInHome(join(home(), 'styles', assertId(styleId), 'frames'));
    await mkdir(fdest, { recursive: true });
    for (const n of frames) await copyFile(join(src, 'frames', n), join(fdest, pre + n));
  }
  return { copied: names.map((n) => `sheets/${pre}${n}`), frames: frames.map((n) => `frames/${pre}${n}`) };
}

/** `copy-file <src> <dest>`: plain copy, both inside home. */
export async function runCopyFile(src: string, dest: string): Promise<{ copied: string }> {
  const s = assertInHome(src);
  const d = assertInHome(dest);
  await mkdir(join(d, '..'), { recursive: true });
  await copyFile(s, d);
  return { copied: d };
}

/** `hf <projectDir> <args...>`: HyperFrames CLI in <projectDir>/comp (init: in <projectDir> as `init comp`). Resolves to the exit code. */
export async function runHf(
  projectDir: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  stdio: 'inherit' | 'ignore' = 'inherit',
): Promise<number> {
  const proj = assertInHome(projectDir);
  validateHfArgs(platform, args);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) assertInHome(args[i + 1]!);
  }
  const init = args[0] === 'init';
  const finalArgs = init ? ['init', 'comp', ...args.slice(1).filter((a) => a !== 'comp')] : args;
  // measure reads a video file, not the composition: run it in the project so it never creates comp/ before init.
  const cwd = init || args[0] === 'measure' ? proj : join(proj, 'comp');
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--out' || args[i] === '--against' || args[i] === '--compare') && args[i + 1]) assertInHome(args[i + 1]!);
  }
  await mkdir(cwd, { recursive: true });
  if (args[0] === 'render') await mkdir(join(proj, 'renders'), { recursive: true });
  const bin = process.env.MOTIONABLE_HF_BIN;
  const c = bin
    ? { cmd: bin, args: finalArgs, shell: false }
    : npxCommand(platform, ['--no-install', 'hyperframes', ...finalArgs]);
  return new Promise((res, rej) => {
    const ch = spawn(c.cmd, c.args, { cwd, stdio, shell: c.shell, windowsHide: true });
    ch.on('error', rej);
    ch.on('close', (code) => res(code ?? 1));
  });
}

async function main(cmd: string | undefined): Promise<void> {
  if (cmd === 'studio') {
    const s = await startStudio({ onShutdown: () => process.exit(0) });
    console.error(s.url);
    const stop = () => void s.close().finally(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } else if (cmd === 'doctor') {
    console.log(JSON.stringify(await doctor(), null, 2));
  } else if (cmd === 'validate') {
    const r = await runValidate(process.argv[3], process.argv[4]);
    console.log(r.out);
    process.exitCode = r.code;
  } else if ((cmd === 'audio-hits' || cmd === 'silences') && process.argv[3]) {
    const f = assertInHome(process.argv[3]);
    if (cmd === 'audio-hits') console.log(JSON.stringify({ hits: findHits(await decodePcm(f)) }));
    else console.log(JSON.stringify(await findSilences(f)));
  } else if (cmd === 'align' && process.argv[3] && process.argv[4]) {
    console.log(JSON.stringify(await runAlign(process.argv[3], process.argv.slice(4))));
  } else if (cmd === 'assemble' && process.argv[3]) {
    console.log(JSON.stringify(await runAssemble(process.argv[3])));
  } else if (cmd === 'palette-check' && process.argv[3]) {
    const r = await runPaletteCheck(process.argv[3]);
    console.log(JSON.stringify({ ok: r.code === 0, offenders: r.offenders.slice(0, 20), allowed: r.allowed }));
    process.exitCode = r.code;
  } else if (cmd === 'sheet' && process.argv[3] && process.argv[4]) {
    console.log(await runSheet(process.argv[3], process.argv[4]));
  } else if (cmd === 'copy-sheets' || cmd === 'copy-file' || cmd === 'probe' || cmd === 'hf') {
    const a = process.argv.slice(3);
    try {
      if (cmd === 'hf') {
        if (!a[0]) throw new Error('usage: motionable hf <projectDir> <args...>');
        process.exitCode = await runHf(a[0], a.slice(1));
      } else if (cmd === 'probe') {
        if (!a[0]) throw new Error('usage: motionable probe <file>');
        console.log(JSON.stringify(await probe(assertInHome(a[0]))));
      } else if (cmd === 'copy-sheets') {
        if (!a[0] || !a[1]) throw new Error('usage: motionable copy-sheets <sheetDir> <styleId> [prefix]');
        console.log(JSON.stringify(await runCopySheets(a[0], a[1], a[2])));
      } else {
        if (!a[0] || !a[1]) throw new Error('usage: motionable copy-file <src> <dest>');
        console.log(JSON.stringify(await runCopyFile(a[0], a[1])));
      }
    } catch (e) {
      console.log(JSON.stringify({ error: (e as Error).message.split('\n')[0] }));
      process.exitCode = 1;
    }
  } else {
    console.error('usage: motionable <studio|doctor|validate <style|plan|words|storyboard> <file>|sheet <video> <outDir>|hf <projectDir> <args...>|copy-sheets <sheetDir> <styleId> [prefix]|probe <file>|copy-file <src> <dest>>');
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  appendBinDir();
  await main(process.argv[2]);
}
