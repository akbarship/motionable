import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/** Root data dir. Read env on every call so tests can swap it. */
export function home(): string {
  return process.env.MOTIONABLE_HOME || join(homedir(), 'Motionable');
}

const ID_RE = /^[a-z0-9-]+$/;

export function assertId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`invalid id: ${JSON.stringify(id)}`);
  return id;
}

export function projectDir(id: string): string {
  return join(home(), 'projects', assertId(id));
}

export function styleDir(id: string): string {
  return join(home(), 'styles', assertId(id));
}

/** realpath of the deepest existing ancestor, with the missing tail re-appended. */
function realish(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail);
    } catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      tail.unshift(cur.slice(up.length).replace(/^[\\/]+/, ''));
      cur = up;
    }
  }
}

/** Returns the absolute path of `p`; throws unless it lies inside home() (symlinks resolved). */
export function assertInHome(p: string): string {
  const abs = resolve(p);
  const rel = relative(realish(home()), realish(abs));
  if (rel === '..' || /^\.\.[\\/]/.test(rel) || isAbsolute(rel)) {
    throw new Error(`path outside Motionable home: ${p}`);
  }
  return abs;
}
