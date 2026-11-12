import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
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

async function main(cmd: string | undefined): Promise<void> {
  if (cmd === 'studio') {
    const s = await startStudio();
    console.error(s.url);
    const stop = () => void s.close().finally(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } else if (cmd === 'doctor') {
    console.log(JSON.stringify(await doctor(), null, 2));
  } else {
    console.error('usage: motionable <studio|doctor>');
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) await main(process.argv[2]);
