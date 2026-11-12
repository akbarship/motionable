import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/** Where the installer puts static ffmpeg / yt-dlp. */
export const binDir = (home: string = homedir()): string => join(home, '.motionable', 'bin');

/** Put `dir` first on PATH (once). Honours the `Path` spelling used on Windows. */
export function prependBinDir(dir: string = binDir(), env: NodeJS.ProcessEnv = process.env): void {
  const key = 'PATH' in env ? 'PATH' : 'Path' in env ? 'Path' : 'PATH';
  const parts = (env[key] ?? '').split(delimiter).filter(Boolean);
  if (parts[0] === dir) return;
  env[key] = [dir, ...parts.filter((p) => p !== dir)].join(delimiter);
}
