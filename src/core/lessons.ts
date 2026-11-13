import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { home, styleDir } from './paths.js';

/** Rules kept per file; the oldest drop off when a new one goes over. */
export const MAX_LESSONS = 40;
const MAX_LESSON_CHARS = 240;
const HEADER = '# Saboqlar\n\nHar qator bitta qoida. Director va executor ish boshida o\'qiydi.\n\n';

/** `global` = the user's taste for every video; any other value is a style id. */
export function lessonsFile(scope: string): string {
  return scope === 'global' ? join(home(), 'lessons.md') : join(styleDir(scope), 'lessons.md');
}

const oneLine = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, MAX_LESSON_CHARS);
/** The rule without its date, lower-cased, for spotting repeats. */
const key = (line: string): string =>
  line
    .replace(/^\d{4}-\d{2}-\d{2}:\s*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Rule lines of a scope, oldest first, without the leading "- ". A missing file is an empty list. */
export async function readLessons(scope: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(lessonsFile(scope), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  return raw
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

async function write(scope: string, lines: string[]): Promise<void> {
  const file = lessonsFile(scope);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, HEADER + lines.map((l) => `- ${l}`).join('\n') + (lines.length > 0 ? '\n' : ''));
}

/** Adds one rule. A rule already there (date and punctuation ignored) is not added twice. */
export async function addLesson(scope: string, text: string, today: string = new Date().toISOString().slice(0, 10)): Promise<{ added: boolean; count: number }> {
  const rule = oneLine(text).replace(/^-\s*/, '');
  if (!rule) throw new Error('lesson text is empty');
  const lines = await readLessons(scope);
  if (lines.some((l) => key(l) === key(rule))) return { added: false, count: lines.length };
  const next = [...lines, `${today}: ${rule}`].slice(-MAX_LESSONS);
  await write(scope, next);
  return { added: true, count: next.length };
}

/** Removes the rule whose line equals `line`. False when it is not there. */
export async function removeLesson(scope: string, line: string): Promise<boolean> {
  const lines = await readLessons(scope);
  const i = lines.indexOf(line.trim());
  if (i < 0) return false;
  lines.splice(i, 1);
  await write(scope, lines);
  return true;
}

/** Every scope that has rules: `global` first, then styles by id. */
export async function allLessons(): Promise<{ scope: string; lines: string[] }[]> {
  const out = [{ scope: 'global', lines: await readLessons('global') }];
  let ids: string[] = [];
  try {
    ids = (await readdir(join(home(), 'styles'))).filter((n) => /^[a-z0-9-]+$/.test(n)).sort();
  } catch {
    // no styles yet
  }
  for (const id of ids) {
    const lines = await readLessons(id);
    if (lines.length > 0) out.push({ scope: id, lines });
  }
  return out;
}
