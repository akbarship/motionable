import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root data dir. Read env on every call so tests can swap it. */
export function home(): string {
  return process.env.MOTIONABLE_HOME || join(homedir(), 'Motionable');
}

export function projectDir(id: string): string {
  return join(home(), 'projects', id);
}

export function styleDir(id: string): string {
  return join(home(), 'styles', id);
}
