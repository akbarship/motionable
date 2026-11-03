// Where the external programs live, the same way on Linux, macOS and Windows. Node only, no dependencies:
// the MCP shim imports this file directly, before anything heavy loads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXE = process.platform === 'win32' ? '.exe' : '';

/** The folder the installer puts ffmpeg/ffprobe into (and a portable Node): <state>/bin. */
export const binDir = () => path.join(process.env.MOTIONABLE_STATE ?? path.join(os.homedir(), '.motionable'), 'bin');

/** ffmpeg or ffprobe: MOTIONABLE_FFMPEG_DIR, then the installer's copy, then whatever is on PATH. */
export const tool = (name: 'ffmpeg' | 'ffprobe') => {
  for (const dir of [process.env.MOTIONABLE_FFMPEG_DIR, binDir()]) {
    if (!dir) continue;
    const p = path.join(dir, name + EXE);
    if (fs.existsSync(p)) return p;
  }
  return name;
};

/**
 * A package's command as [node, [script, ...args]]: the JS file from the package's `bin` field, run by this Node.
 * node_modules/.bin holds shell scripts (and .cmd files on Windows) that spawn can't run everywhere; this can.
 */
export const nodeBin = (pkg: string, args: string[] = [], bin = pkg): [string, string[]] => {
  const dir = path.join(REPO, 'node_modules', pkg);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {bin?: string | Record<string, string>};
  const rel = typeof j.bin === 'string' ? j.bin : j.bin?.[bin];
  if (!rel) throw new Error(`${pkg} has no "${bin}" command`);
  return [process.execPath, [path.join(dir, rel), ...args]];
};
