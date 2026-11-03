// The base clip: the kept source spans joined into one CFR clip that the composition plays straight through.
// HyperFrames is frame-exact on such a clip (docs/v2/engine-check.md). The source must already be CFR at `fps`.
// Each span is encoded on its own (cached by its span, so changing one cut re-encodes one piece), then the pieces
// are joined: video without re-encoding, audio from sample-exact WAV pieces encoded once (per-piece AAC would add
// priming and drift). One piece at a time keeps memory low on 1440×2560 sources.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {ffmpeg} from './ffmpeg';

export type KeptSpan = {srcIn: number; len: number}; // source seconds, output frames (ResolvedPlan.segments)

const FADE = 0.01; // s: a short audio fade on each side of a join, so cuts don't click
const VIDEO = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '15', '-pix_fmt', 'yuv420p', '-threads', '4'];
const RATE = 48000; // a frame at 30 fps is exactly 1600 samples, so WAV pieces join without drift

export const conformBase = async (source: string, spans: KeptSpan[], fps: number, out: string, cacheDir = path.join(path.dirname(out), 'pieces')) => {
  if (!spans.length) throw new Error('no kept spans');
  fs.mkdirSync(cacheDir, {recursive: true});
  const st = fs.statSync(source);
  const pieces: {v: string; a: string}[] = [];
  for (const g of spans) {
    const a = Math.round(g.srcIn * fps);
    const dur = g.len / fps;
    const key = crypto.createHash('sha1').update(JSON.stringify([source, st.size, st.mtimeMs, a, g.len, fps])).digest('hex').slice(0, 16);
    const piece = {v: path.join(cacheDir, `${key}.mp4`), a: path.join(cacheDir, `${key}.wav`)};
    if (!fs.existsSync(piece.v) || !fs.existsSync(piece.a)) {
      // a span may run past the source's last frame (plan times are rounded): hold the last frame and pad silence,
      // so every piece is exactly g.len frames and the plan's frame map stays true
      const tv = `${piece.v}.part.mp4`;
      const ta = `${piece.a}.part.wav`;
      await ffmpeg(['-ss', String(a / fps), '-i', source,
        '-map', '0:v', '-vf', 'tpad=stop_mode=clone:stop_duration=1', '-frames:v', String(g.len), '-r', String(fps), ...VIDEO, '-an', tv,
        '-map', '0:a', '-af', `aresample=${RATE},apad,atrim=end_sample=${Math.round(dur * RATE)},` +
          `afade=t=in:d=${FADE},afade=t=out:st=${Math.max(0, dur - FADE)}:d=${FADE}`, '-ac', '2', '-c:a', 'pcm_s16le', ta]);
      fs.renameSync(tv, piece.v);
      fs.renameSync(ta, piece.a);
    }
    pieces.push(piece);
  }
  const list = (name: string, files: string[]) => {
    const f = path.join(cacheDir, name);
    fs.writeFileSync(f, files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    return f;
  };
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list('video.txt', pieces.map((p) => p.v)),
    '-f', 'concat', '-safe', '0', '-i', list('audio.txt', pieces.map((p) => p.a)),
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', `${out}.part.mp4`]);
  fs.renameSync(`${out}.part.mp4`, out); // whole or not at all: a player may ask for it any moment
};
