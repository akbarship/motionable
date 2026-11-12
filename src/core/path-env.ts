import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Where the installer puts fallback static ffmpeg / yt-dlp. */
export const binDir = (home: string = homedir()): string => join(home, '.motionable', 'bin');

/** Add `dir` to the END of PATH (once), so tools already on PATH win. Honours the `Path` spelling used on Windows. */
export function appendBinDir(dir: string = binDir(), env: NodeJS.ProcessEnv = process.env): void {
  const key = 'PATH' in env ? 'PATH' : 'Path' in env ? 'Path' : 'PATH';
  const parts = (env[key] ?? '').split(delimiter).filter(Boolean);
  if (parts.includes(dir)) return;
  env[key] = [...parts, dir].join(delimiter);
}
