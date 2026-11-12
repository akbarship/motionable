import { execFile } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { projectDir } from '../core/paths.js';
import { ALLOWED_EXTS } from '../server/upload.js';

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

/** yt-dlp format selectors, tried in order. H.264 DASH first: progressive `mp4/best` can sit on a CDN host some networks cannot resolve. */
export const FORMAT_SELECTORS = ['bv*[vcodec^=avc1]+ba', 'bv*+ba/b', 'mp4/best'] as const;

const MSG = {
  network: "Instagram serveriga ulanib bo'lmadi (tarmoq/DNS). Videoni o'zingiz yuklang.",
  login: "Instagram kirishni talab qilyapti. Videoni o'zingiz yuklang.",
  gone: "Post yopiq yoki o'chirilgan. Videoni o'zingiz yuklang.",
  noBin: "yt-dlp topilmadi. Videoni o'zingiz yuklang.",
  unknown: "Havoladan yuklab bo'lmadi. Videoni o'zingiz yuklang.",
} as const;

/** Uzbek reason for a failed yt-dlp run, from its stderr. */
export function refErrorReason(stderr: string): string {
  const s = stderr.toLowerCase();
  if (/login required|rate-limit|log in|cookies|authentication/.test(s)) return MSG.login;
  if (/private|has been removed|does not exist|not found|http error 404|video unavailable|content is not available/.test(s)) return MSG.gone;
  if (/name resolution|getaddrinfo|failed to resolve|timed out|timeout|connection (refused|reset|aborted)|network is unreachable|unable to download|ssl|errno/.test(s)) {
    return MSG.network;
  }
  return MSG.unknown;
}

/** A selector the media does not offer: try the next one instead of failing. */
const formatMissing = (stderr: string) => /requested format is not available|no video formats found/i.test(stderr);

/** Downloads a reference video into the project's refs/ dir with yt-dlp; returns the file path. */
export async function downloadRef(projectId: string, url: string): Promise<string> {
  if (url.startsWith('-')) throw new RefDownloadError(MSG.unknown);
  const refs = join(projectDir(projectId), 'refs');
  await mkdir(refs, { recursive: true });
  const refsAbs = resolve(refs);
  const okFile = (f: string) => dirname(resolve(f)) === refsAbs && ALLOWED_EXTS.has(extname(f).toLowerCase());
  const bin = process.env.MOTIONABLE_YTDLP || 'yt-dlp';
  const started = Date.now() - 50;
  let stdout = '';
  let reason: string = MSG.unknown;
  let got = false;
  for (const fmt of FORMAT_SELECTORS) {
    try {
      ({ stdout } = await run(
        bin,
        [
          '-f', fmt,
          '--retries', '3',
          '--merge-output-format', 'mp4',
          '-o', join(refs, '%(id)s.%(ext)s'),
          '--no-playlist',
          '--print', 'after_move:filepath',
          '--',
          url,
        ],
        { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
      ));
      got = true;
      break;
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stderr?: unknown };
      if (err.code === 'ENOENT') throw new RefDownloadError(MSG.noBin);
      const stderr = String(err.stderr ?? '');
      console.error(`[motionable] yt-dlp -f ${fmt} failed: ${stderr.trim().split('\n').slice(-3).join(' | ').slice(-600)}`);
      if (formatMissing(stderr)) continue;
      reason = refErrorReason(stderr);
      // login / removed post: other formats will not help
      if (reason === MSG.login || reason === MSG.gone) break;
    }
  }
  if (!got) throw new RefDownloadError(reason);
  const printed = stdout.trim().split('\n').pop()?.trim();
  if (printed && okFile(printed)) {
    try {
      if ((await stat(printed)).isFile()) return resolve(printed);
    } catch {
      // fall through to newest file
    }
  }
  let best: { f: string; m: number } | null = null;
  for (const name of await readdir(refs)) {
    const f = join(refs, name);
    if (!okFile(f)) continue;
    const st = await stat(f);
    if (st.isFile() && st.mtimeMs >= started && (!best || st.mtimeMs > best.m)) best = { f, m: st.mtimeMs };
  }
  if (!best) throw new RefDownloadError(MSG.unknown);
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
