import { homedir } from 'node:os';
import { join } from 'node:path';

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
