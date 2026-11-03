// ffmpeg and ffprobe calls. Node only.
import {spawn} from 'node:child_process';

/** Runs a command; resolves with stdout (or stderr with `stderr: true`, for ffmpeg's measurements). */
export const run = (cmd: string, args: string[], {stderr = false} = {}) => new Promise<string>((resolve, reject) => {
  const p = spawn(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve(stderr ? err : out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))));
});

export const ffmpeg = (args: string[]) => run('ffmpeg', ['-v', 'error', '-y', ...args]);

export type Probe = {w: number; h: number; fps: number; duration: number; frames?: number; audio: boolean};

export const probe = async (file: string): Promise<Probe> => {
  const j = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
  const v = j.streams.find((s: {codec_type: string}) => s.codec_type === 'video');
  const [n, d] = String(v?.r_frame_rate ?? '30/1').split('/').map(Number);
  return {
    w: v?.width ?? 0,
    h: v?.height ?? 0,
    fps: n / (d || 1),
    duration: Number(j.format.duration),
    frames: v?.nb_frames ? Number(v.nb_frames) : undefined,
    audio: j.streams.some((s: {codec_type: string}) => s.codec_type === 'audio'),
  };
};
