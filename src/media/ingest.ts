import { execFile } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { projectDir } from '../core/paths.js';

const run = promisify(execFile);

export class RefUrlError extends Error {}
export class RefDownloadError extends Error {}

/** Accepts only http(s) URLs; strips tracking query and hash from instagram.com links. */
export function normalizeRefUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new RefUrlError('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new RefUrlError('only http(s) urls allowed');
  const host = u.hostname.toLowerCase();
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    u.search = '';
    u.hash = '';
  }
  return u.toString();
}

/** Downloads a reference video into the project's refs/ dir with yt-dlp; returns the file path. */
export async function downloadRef(projectId: string, url: string): Promise<string> {
  const refs = join(projectDir(projectId), 'refs');
  await mkdir(refs, { recursive: true });
  const bin = process.env.MOTIONABLE_YTDLP || 'yt-dlp';
  let stdout: string;
  try {
    ({ stdout } = await run(
      bin,
      ['-f', 'mp4/best', '-o', join(refs, '%(id)s.%(ext)s'), '--no-playlist', '--print', 'after_move:filepath', url],
      { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch {
    throw new RefDownloadError('Faylni yuklang');
  }
  const printed = stdout.trim().split('\n').pop()?.trim();
  if (printed) {
    try {
      if ((await stat(printed)).isFile()) return printed;
    } catch {
      // fall through to newest file
    }
  }
  let best: { f: string; m: number } | null = null;
  for (const name of await readdir(refs)) {
    const f = join(refs, name);
    const s = await stat(f);
    if (s.isFile() && (!best || s.mtimeMs > best.m)) best = { f, m: s.mtimeMs };
  }
  if (!best) throw new RefDownloadError('Faylni yuklang');
  return best.f;
}

export interface ProbeResult {
  duration: number;
  w: number;
  h: number;
  fps: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const j = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }[];
    format?: { duration?: string };
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('no video stream');
  const [n, d] = (v.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = d ? n / d : n || 0;
  const duration = Number(j.format?.duration ?? v.duration ?? 0);
  return {
    duration,
    w: v.width ?? 0,
    h: v.height ?? 0,
    fps,
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
  };
}
