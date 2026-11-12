import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { ZodType } from 'zod';
import { PlanSchema, StyleSchema, WordsSchema } from './core/types.js';
import { buildRefSheet, type RefSheet } from './media/refsheet.js';
import { startStudio } from './server/studio.js';

const run = promisify(execFile);

/** True when `cmd args` exits 0. Never uses a shell. */
async function works(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args, { timeout: 60_000 });
    return true;
  } catch {
    return false;
  }
}

export const nodeOk = (version: string): boolean => Number(version.replace(/^v/, '').split('.')[0]) >= 22;

export async function doctor() {
  const node = nodeOk(process.versions.node);
  const [ffmpeg, ytdlp, hyperframes] = await Promise.all([
    works('ffmpeg', ['-version']),
    works('yt-dlp', ['--version']),
    works('npx', ['--no-install', 'hyperframes', 'doctor', '--json']),
  ]);
  return { ok: node && ffmpeg && hyperframes, node, ffmpeg, ytdlp, hyperframes };
}

const SCHEMAS: Record<string, ZodType> = { style: StyleSchema, plan: PlanSchema, words: WordsSchema };
const MAX_ISSUES = 8;

/** `motionable validate <style|plan|words> <file>`: code 0 + "ok", or 1 + a short issue list. */
export async function runValidate(kind: string | undefined, file: string | undefined): Promise<{ code: number; out: string }> {
  const schema = kind ? SCHEMAS[kind] : undefined;
  if (!schema || !file) return { code: 1, out: 'usage: motionable validate <style|plan|words> <file>' };
  let data: unknown;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    return { code: 1, out: `cannot read JSON: ${(e as Error).message.split('\n')[0]}` };
  }
  const r = schema.safeParse(data);
  if (r.success) return { code: 0, out: 'ok' };
  const lines = r.error.issues.slice(0, MAX_ISSUES).map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`);
  const more = r.error.issues.length - lines.length;
  return { code: 1, out: [...lines, ...(more > 0 ? [`- ... ${more} more`] : [])].join('\n') };
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

async function main(cmd: string | undefined): Promise<void> {
  if (cmd === 'studio') {
    const s = await startStudio();
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
  } else if (cmd === 'sheet' && process.argv[3] && process.argv[4]) {
    console.log(await runSheet(process.argv[3], process.argv[4]));
  } else {
    console.error('usage: motionable <studio|doctor|validate <style|plan|words> <file>|sheet <video> <outDir>>');
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) await main(process.argv[2]);
