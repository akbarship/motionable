// The master source: originals normalized (CFR 30, H.264, SDR, rotation applied) and joined in upload order, plus
// the voice audio (for transcription), loudness and the contact sheet Claude looks at. Ported from an earlier
// Motionable version (media.py). Node only.
import fs from 'node:fs';
import path from 'node:path';
import {ffmpeg, run} from './ffmpeg';

export const FPS = 30;
// Portrait: 1440×2560 is enough for a 1080×1920 reel and keeps decoding light on a 7 GB machine. Landscape keeps up
// to 4K: the vertical crop uses the full height.
const maxLongSide = (w: number, h: number) => (w > h ? 3840 : 2560);

export type MediaInfo = {
  file: string;
  duration: number;
  video: {codec: string; w: number; h: number; pixFmt: string; fps: number; avgFps: number; vfr: boolean; rotation: number; transfer: string; hdr: boolean};
  audio: null | {codec: string; sampleRate: number; channels: number};
};

const frac = (s = '0/1') => {
  const [n, d] = s.split('/').map(Number);
  return d ? n / d : 0;
};

export const probeMedia = async (file: string): Promise<MediaInfo> => {
  const d = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const v = d.streams.find((s: {codec_type: string}) => s.codec_type === 'video');
  const a = d.streams.find((s: {codec_type: string}) => s.codec_type === 'audio');
  if (!v) throw new Error(`${path.basename(file)}: no video stream`);
  let rotation = 0;
  for (const sd of v.side_data_list ?? []) if ('rotation' in sd) rotation = Number(sd.rotation);
  if (v.tags?.rotate) rotation = Number(v.tags.rotate);
  const r = frac(v.r_frame_rate);
  const avg = v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? frac(v.avg_frame_rate) : r;
  let [w, h] = [Number(v.width), Number(v.height)];
  if (Math.abs(rotation) % 180 === 90) [w, h] = [h, w]; // the size as displayed
  const transfer = v.color_transfer ?? '';
  return {
    file: path.basename(file),
    duration: +Number(d.format.duration).toFixed(3),
    video: {codec: v.codec_name, w, h, pixFmt: v.pix_fmt, fps: +r.toFixed(3), avgFps: +avg.toFixed(3), vfr: r !== 0 && Math.abs(r - avg) > 0.01,
      rotation, transfer, hdr: transfer === 'arib-std-b67' || transfer === 'smpte2084'},
    audio: a ? {codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: Number(a.channels)} : null,
  };
};

/** Why the original can't be used as is (empty: a stream copy is enough). */
export const normalizeReasons = (info: MediaInfo, size?: {w: number; h: number}) => {
  const v = info.video;
  const out: string[] = [];
  if (v.codec !== 'h264') out.push(`codec ${v.codec} → h264`);
  if (v.pixFmt !== 'yuv420p' && v.pixFmt !== 'yuvj420p') out.push(`pixel format ${v.pixFmt} → yuv420p`);
  if (v.vfr) out.push(`variable frame rate (avg ${v.avgFps}) → constant ${FPS}`);
  else if (Math.abs(v.fps - FPS) > 1e-3) out.push(`${v.fps} fps → ${FPS}`);
  if (v.rotation) out.push(`rotation ${v.rotation}° applied`);
  if (v.hdr) out.push(`HDR (${v.transfer}) tone-mapped to SDR BT.709`);
  if (Math.max(v.w, v.h) > maxLongSide(v.w, v.h)) out.push(`${v.w}×${v.h} scaled to fit ${maxLongSide(v.w, v.h)}`);
  if (size && (size.w !== v.w || size.h !== v.h)) out.push(`${v.w}×${v.h} fitted to ${size.w}×${size.h} to join with the first clip`);
  if (!info.audio) out.push('no audio: silence added');
  else if (info.audio.codec !== 'aac') out.push(`audio ${info.audio.codec} → aac`);
  return out;
};

/** The output size for a clip: its own, scaled down to the limit, even numbers. */
export const masterSize = (info: MediaInfo) => {
  const {w, h} = info.video;
  const k = Math.min(1, maxLongSide(w, h) / Math.max(w, h));
  return {w: Math.floor((w * k) / 2) * 2, h: Math.floor((h * k) / 2) * 2};
};

/**
 * One clip → the master format. `size` forces the frame size; `encode` forces a re-encode even when a copy would do.
 */
export const normalize = async (src: string, out: string, info: MediaInfo, size?: {w: number; h: number}, encode = false) => {
  const reasons = normalizeReasons(info, size);
  const tmp = `${out}.part.mp4`;
  const videoOk = !encode && !reasons.some((r) => !r.startsWith('audio') && !r.startsWith('no audio'));
  const args = ['-i', src];
  if (!info.audio) args.push('-f', 'lavfi', '-t', String(info.duration), '-i', 'anullsrc=r=48000:cl=stereo');
  args.push('-map', '0:v:0', '-map', info.audio ? '0:a:0' : '1:a:0');
  if (videoOk) args.push('-c:v', 'copy');
  else {
    const v = info.video;
    const vf: string[] = [];
    if (v.hdr) vf.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv');
    const s = size ?? masterSize(info);
    if (s.w !== v.w || s.h !== v.h) vf.push(`scale=${s.w}:${s.h}:force_original_aspect_ratio=decrease`, `pad=${s.w}:${s.h}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1');
    vf.push(`fps=${FPS}`, 'format=yuv420p');
    args.push('-vf', vf.join(','), '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast', '-threads', '4',
      '-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  }
  const audioOk = !encode && info.audio?.codec === 'aac' && info.audio.sampleRate === 48000;
  args.push(...(audioOk ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']));
  if (!info.audio) args.push('-shortest');
  args.push('-movflags', '+faststart', tmp);
  await ffmpeg(args);
  fs.renameSync(tmp, out);
  return reasons;
};

const RATE = 48000; // a frame at 30 fps is exactly 1600 samples, so WAV parts join without drift

/** One clip for joining: its video encoded alone, and its audio as a WAV of exactly the video's length. */
const joinPart = async (src: string, info: MediaInfo, size: {w: number; h: number}, video: string, wav: string) => {
  const v = info.video;
  const vf: string[] = [];
  if (v.hdr) vf.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv');
  if (size.w !== v.w || size.h !== v.h) vf.push(`scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease`, `pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2`, 'setsar=1');
  vf.push(`fps=${FPS}`, 'format=yuv420p');
  await ffmpeg(['-i', src, '-map', '0:v:0', '-an', '-vf', vf.join(','), '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '17', '-preset', 'fast',
    '-threads', '4', '-profile:v', 'high', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', video]);
  const frames = Number((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets',
    '-of', 'csv=p=0', video])).trim());
  const samples = frames * (RATE / FPS);
  const audio = info.audio ? ['-i', src, '-map', '0:a:0'] : ['-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=stereo`];
  await ffmpeg([...audio, '-af', `aresample=${RATE},apad,atrim=end_sample=${samples}`, '-ac', '2', '-c:a', 'pcm_s16le', wav]);
  return frames;
};

/** Clips joined in upload order into one master source. A single clip is just normalized. */
export const buildSource = async (files: string[], out: string, work: string) => {
  const infos = await Promise.all(files.map(probeMedia));
  if (files.length === 1) return {reasons: await normalize(files[0], out, infos[0]), infos};
  const size = masterSize(infos[0]);
  fs.mkdirSync(work, {recursive: true});
  const parts: {video: string; wav: string}[] = [];
  const reasons: string[] = [`${files.length} clips joined in upload order`];
  for (const [i, f] of files.entries()) {
    const part = {video: path.join(work, `clip-${i + 1}.mp4`), wav: path.join(work, `clip-${i + 1}.wav`)};
    for (const r of normalizeReasons(infos[i], size)) reasons.push(`clip ${i + 1}: ${r}`);
    await joinPart(f, infos[i], size, part.video, part.wav);
    parts.push(part);
  }
  // video joined without re-encoding; audio from sample-exact WAVs, encoded once (per-file AAC would drift ~10 ms a join)
  const list = (name: string, files: string[]) => {
    const p = path.join(work, name);
    fs.writeFileSync(p, files.map((x) => `file '${x.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    return p;
  };
  const vl = list('video.txt', parts.map((p) => p.video));
  const al = list('audio.txt', parts.map((p) => p.wav));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', vl, '-f', 'concat', '-safe', '0', '-i', al, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', `${out}.part.mp4`]);
  fs.renameSync(`${out}.part.mp4`, out);
  fs.rmSync(work, {recursive: true, force: true});
  return {reasons, infos};
};

/** A voiceover's master source: the canvas as one flat colour, with the voice as its sound. Compose, build and
 *  render then work as for footage (a base video the sound comes from); the picture is covered by motion and b-roll. */
export const audioSource = async (audio: string, out: string, {w = 1080, h = 1920, fps = 30, color = '#000000'} = {}) => {
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=${color.replace('#', '0x')}:s=${w}x${h}:r=${fps}`, '-i', audio,
    '-map', '0:v', '-map', '1:a', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-pix_fmt', 'yuv420p',
    '-g', String(fps), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', `${out}.part.mp4`]);
  fs.renameSync(`${out}.part.mp4`, out);
};

/** Mono MP3 for transcription. */
export const voiceAudio = async (src: string, out: string) => {
  await ffmpeg(['-i', src, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '128k', `${out}.part.mp3`]);
  fs.renameSync(`${out}.part.mp3`, out);
};

/** EBU R128 integrated loudness, range and true peak. */
export const loudness = async (src: string) => {
  const err = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'], {stderr: true});
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const num = (key: string) => Number((new RegExp(`${key}:\\s+(-?[\\d.]+|-inf)`).exec(summary)?.[1] ?? '-120').replace('-inf', '-120'));
  return {integratedLufs: num('I'), rangeLu: num('LRA'), truePeakDbtp: num('Peak')};
};

/**
 * The contact sheet Claude looks at to judge framing and movement: up to 32 small frames evenly over the video,
 * 8 per row, each 120 px wide (about 1,000 px across). Returns the seconds each tile shows.
 */
export const contactSheet = async (src: string, out: string, duration: number, max = 32) => {
  const n = Math.max(1, Math.min(max, Math.floor(duration)));
  const step = duration / n;
  const rows = Math.ceil(n / 8);
  await ffmpeg(['-i', src, '-vf', `fps=${1 / step},scale=120:-2,tile=8x${rows}:padding=2:color=black`, '-frames:v', '1', '-q:v', '7', out]);
  return Array.from({length: n}, (_, i) => +(i * step).toFixed(2));
};

/** A b-roll clip as the page plays it: covers the frame (centre crop), CFR 30, short GOP so seeks land, no audio. */
export const conformBroll = async (src: string, out: string, size: {w: number; h: number}) => {
  const tmp = `${out}.part.mp4`;
  await ffmpeg(['-i', src, '-map', '0:v:0', '-an', '-vf',
    `scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h},setsar=1,fps=${FPS},format=yuv420p`,
    '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '19', '-preset', 'fast', '-g', '15', '-threads', '4', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, out);
};

/** A small still for lists: a frame at `at` seconds (or the image itself, scaled). */
export const thumbnail = (src: string, out: string, at = 1) =>
  ffmpeg([...(at > 0 ? ['-ss', String(at)] : []), '-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', out]);

/**
 * Delivery loudness, two passes of ffmpeg's loudnorm (measure, then apply linearly): −14 LUFS integrated and −1 dBTP
 * by default, the reels standard. The video stream is copied; only the sound is re-encoded.
 */
export const normalizeLoudness = async (src: string, out: string, target = -14, peak = -1) => {
  const err = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-map', '0:a:0', '-af',
    `loudnorm=I=${target}:TP=${peak}:LRA=11:print_format=json`, '-f', 'null', '-'], {stderr: true});
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1)) as Record<string, string>;
  const tmp = `${out}.part.mp4`;
  await ffmpeg(['-i', src, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af',
    `loudnorm=I=${target}:TP=${peak}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, out);
  return loudness(out);
};
