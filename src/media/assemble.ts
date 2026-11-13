import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Cut, Words } from '../core/types.js';
import { findSilences, type Silence } from './audio.js';

const run = promisify(execFile);

/** Breath kept before the first and after the last word of a segment. */
export const PAD_S = 0.08;
const FADE_S = 0.02;
/** A pause longer than this inside a kept take is cut down to 2 x KEEP_S. */
export const MAX_PAUSE_S = 0.6;
const KEEP_S = 0.12;

/** Splits a segment around every long pause inside it, keeping a short natural breath. */
export function splitPauses<T extends { in: number; out: number }>(seg: T, silences: Silence[]): T[] {
  const out: T[] = [];
  let start = seg.in;
  for (const s of silences) {
    if (s.start <= start || s.end >= seg.out || s.end - s.start <= MAX_PAUSE_S) continue;
    out.push({ ...seg, in: start, out: Math.round((s.start + KEEP_S) * 1000) / 1000 });
    start = Math.round((s.end - KEEP_S) * 1000) / 1000;
  }
  out.push({ ...seg, in: start, out: seg.out });
  return out;
}

interface MediaInfo {
  duration: number;
  video: { w: number; h: number; fps: number } | null;
  hasAudio: boolean;
}

async function info(file: string): Promise<MediaInfo> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const j = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; r_frame_rate?: string; disposition?: { attached_pic?: number } }[];
    format?: { duration?: string };
  };
  const v = j.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const [n, d] = (v?.r_frame_rate ?? '30/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration ?? 0),
    video: v ? { w: v.width ?? 1080, h: v.height ?? 1920, fps: Math.round((d ? n / d : n) || 30) } : null,
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
  };
}

/**
 * Moves a cut point that falls in a silence next to the speech, keeping PAD_S of breath:
 * `in` just before the next word, `out` just after the last one. Points inside speech stay.
 */
export function snapToSpeech(seg: { in: number; out: number }, silences: Silence[], duration: number): { in: number; out: number } {
  let a = seg.in;
  let b = seg.out;
  const sIn = silences.find((s) => a >= s.start && a <= s.end);
  if (sIn) a = Math.max(sIn.start, sIn.end - PAD_S);
  const sOut = silences.find((s) => b >= s.start && b <= s.end);
  if (sOut) b = Math.min(sOut.end, sOut.start + PAD_S);
  a = Math.max(0, a);
  b = Math.min(duration || b, b);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return b - a >= 0.2 ? { in: r(a), out: r(b) } : { in: r(seg.in), out: r(seg.out) };
}

/** Words of each segment moved onto the body timeline. */
export function remapWords(segs: { in: number; out: number; words: Words }[]): Words {
  const out: Words = [];
  let offset = 0;
  for (const s of segs) {
    for (const w of s.words) {
      if (w.start >= s.in - 0.01 && w.end <= s.out + 0.01) {
        const r = (x: number) => Math.round(Math.max(0, x - s.in + offset) * 1000) / 1000;
        out.push({ w: w.w, start: r(w.start), end: r(w.end) });
      }
    }
    offset += s.out - s.in;
  }
  return out;
}

async function wordsOf(file: string): Promise<Words> {
  try {
    return JSON.parse(await readFile(join(dirname(file), `${basename(file, extname(file))}.words.json`), 'utf8')) as Words;
  } catch {
    return [];
  }
}

/**
 * Joins the cut's segments into one body: cuts snapped next to speech, 20 ms fades at every join
 * (no clicks, A/V stays in sync), loudness to -14 LUFS. Video sources give body.mp4 (scaled to the
 * first clip), audio-only sources give body.wav. Writes body.words.json beside it.
 * `resolveSrc` maps a cut path (project-relative) to an absolute file.
 */
export async function assemble(
  cut: Cut,
  resolveSrc: (src: string) => string,
  outDir: string,
): Promise<{ body: string; duration: number; segments: { src: string; in: number; out: number; line?: string }[]; words: Words }> {
  if (cut.segments.length === 0) throw new Error('cut has no segments');
  const files = [...new Set(cut.segments.map((s) => s.src))];
  const meta = new Map<string, { info: MediaInfo; silences: Silence[]; words: Words }>();
  for (const src of files) {
    const abs = resolveSrc(src);
    const i = await info(abs);
    if (!i.hasAudio) throw new Error(`${src} has no audio`);
    meta.set(src, { info: i, silences: (await findSilences(abs)).silences, words: await wordsOf(abs) });
  }
  const kinds = new Set(files.map((f) => (meta.get(f)!.info.video ? 'video' : 'audio')));
  if (kinds.size > 1) throw new Error('mix of video and audio-only sources; cut them separately');
  const video = kinds.has('video');
  const first = meta.get(cut.segments[0].src)!.info.video;

  const segs = cut.segments.flatMap((s) => {
    const m = meta.get(s.src)!;
    const snapped = { src: s.src, ...(s.line ? { line: s.line } : {}), ...snapToSpeech(s, m.silences, m.info.duration) };
    return splitPauses(snapped, m.silences);
  });

  const args: string[] = ['-v', 'error', '-y'];
  const parts: string[] = [];
  const labels: string[] = [];
  segs.forEach((s, i) => {
    args.push('-i', resolveSrc(s.src));
    const len = s.out - s.in;
    const fadeOut = Math.max(0, len - FADE_S).toFixed(3);
    parts.push(
      `[${i}:a]atrim=start=${s.in}:end=${s.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,` +
        `afade=t=in:d=${FADE_S},afade=t=out:st=${fadeOut}:d=${FADE_S}[a${i}]`,
    );
    if (video && first) {
      parts.push(
        `[${i}:v]trim=start=${s.in}:end=${s.out},setpts=PTS-STARTPTS,` +
          `scale=${first.w}:${first.h}:force_original_aspect_ratio=decrease,pad=${first.w}:${first.h}:(ow-iw)/2:(oh-ih)/2,` +
          `fps=${first.fps},format=yuv420p,setsar=1[v${i}]`,
      );
      labels.push(`[v${i}][a${i}]`);
    } else labels.push(`[a${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${segs.length}:v=${video ? 1 : 0}:a=1${video ? '[v]' : ''}[ac]`);
  parts.push('[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]');
  const body = join(outDir, video ? 'body.mp4' : 'body.wav');
  args.push('-filter_complex', parts.join(';'));
  if (video) args.push('-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
  else args.push('-map', '[a]', '-c:a', 'pcm_s16le');
  args.push(body);
  await run('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });

  const words = remapWords(segs.map((s) => ({ ...s, words: meta.get(s.src)!.words })));
  const duration = Math.round(segs.reduce((t, s) => t + s.out - s.in, 0) * 1000) / 1000;
  return { body, duration, segments: segs, words };
}
