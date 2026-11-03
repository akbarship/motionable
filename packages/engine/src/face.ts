// Track the speaker's face for the camera and for captions that must stay off it (Motionable's track.py method,
// in Node): YuNet (OpenCV Zoo, MIT) on onnxruntime-web's WASM backend, so it runs the same in the daemon and in a
// desktop build with no Python and no native addon. 10 samples a second, the most confident face per sample, gaps
// interpolated, then a zero-phase Gaussian: the camera follows like an operator, not a jittery tracker.
// Output: {fps, w, h, samples: [{t, cx, cy, w, h, found}]}, cx/cy/w/h in 0..1 of the source.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as ort from 'onnxruntime-web';
import {tool} from './bin';
import {probe} from './ffmpeg';

const MODEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../models/face_detection_yunet_2023mar.onnx');
const SIZE = 640; // the model's fixed input
const STRIDES = [8, 16, 32];
const THRESHOLD = 0.6;
const SMOOTH_S = 0.35; // Gaussian sigma in seconds for position; size is smoothed 2x more

export type FaceBox = {cx: number; cy: number; w: number; h: number; score: number}; // model pixels
export type TrackSample = {t: number; cx: number; cy: number; w: number; h: number; found: boolean};
export type FaceTrack = {fps: number; w: number; h: number; samples: TrackSample[]};

type Outputs = Record<string, {data: ArrayLike<number>}>;

/** The most confident face in one YuNet output (OpenCV's FaceDetectorYN decoding), or null under the threshold. */
export const decodeYunet = (o: Outputs, size = SIZE): FaceBox | null => {
  let best: FaceBox | null = null;
  for (const s of STRIDES) {
    const cols = size / s;
    const cls = o[`cls_${s}`].data, obj = o[`obj_${s}`].data, box = o[`bbox_${s}`].data;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < THRESHOLD || (best && score <= best.score)) continue;
      const r = Math.floor(i / cols), c = i % cols;
      best = {cx: (c + box[i * 4]) * s, cy: (r + box[i * 4 + 1]) * s, w: Math.exp(box[i * 4 + 2]) * s, h: Math.exp(box[i * 4 + 3]) * s, score};
    }
  }
  return best;
};

const gauss = (x: number[], sigma: number) => {
  const r = Math.floor(3 * sigma) + 1;
  const k = Array.from({length: 2 * r + 1}, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const sum = k.reduce((a, b) => a + b, 0);
  return x.map((_, i) => k.reduce((acc, w, j) => acc + (w / sum) * x[Math.min(x.length - 1, Math.max(0, i + j - r))], 0));
};

/** Fill gaps (NaN) linearly between found samples; the ends hold the nearest found value. */
const interpolate = (x: number[]) => {
  const ok = x.map((v, i) => (Number.isNaN(v) ? -1 : i)).filter((i) => i >= 0);
  return x.map((v, i) => {
    if (!Number.isNaN(v)) return v;
    const after = ok.find((j) => j > i);
    const before = [...ok].reverse().find((j) => j < i);
    if (before === undefined) return x[after!];
    if (after === undefined) return x[before];
    return x[before] + ((x[after] - x[before]) * (i - before)) / (after - before);
  });
};

/** Track the face through a video; writes the track JSON to `out` and returns it with a few stats. */
export const trackFace = async (src: string, out: string, fps = 10) => {
  const info = await probe(src);
  const scale = SIZE / Math.max(info.w, info.h);
  const dw = Math.round((info.w * scale) / 2) * 2, dh = Math.round((info.h * scale) / 2) * 2;
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(fs.readFileSync(MODEL));
  // frames letterboxed into the model's square from the top-left, as BGR bytes
  const dec = spawn(tool('ffmpeg'), ['-v', 'error', '-i', src, '-vf', `fps=${fps},scale=${dw}:${dh},pad=${SIZE}:${SIZE}:0:0`,
    '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], {stdio: ['ignore', 'pipe', 'pipe']});
  const frame = SIZE * SIZE * 3;
  const input = new Float32Array(frame);
  const raw: [number, number, number, number, boolean][] = [];
  let buf = Buffer.alloc(0);
  for await (const chunk of dec.stdout) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    while (buf.length >= frame) {
      const px = buf.subarray(0, frame);
      for (let i = 0, n = SIZE * SIZE; i < n; i++) {
        input[i] = px[i * 3];
        input[n + i] = px[i * 3 + 1];
        input[2 * n + i] = px[i * 3 + 2];
      }
      buf = buf.subarray(frame);
      const f = decodeYunet(await session.run({input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE])}) as Outputs);
      raw.push(f ? [f.cx / dw, f.cy / dh, f.w / dw, f.h / dh, true] : [NaN, NaN, NaN, NaN, false]);
    }
  }
  await new Promise((r) => dec.on('close', r));
  if (!raw.some((x) => x[4])) throw new Error('no face found in the video');
  const cols = [0, 1, 2, 3].map((c) => interpolate(raw.map((x) => x[c] as number)));
  const sm = [gauss(cols[0], SMOOTH_S * fps), gauss(cols[1], SMOOTH_S * fps), gauss(cols[2], 2 * SMOOTH_S * fps), gauss(cols[3], 2 * SMOOTH_S * fps)];
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const samples = raw.map((x, i) => ({t: Math.round((i / fps) * 1000) / 1000, cx: r4(sm[0][i]), cy: r4(sm[1][i]), w: r4(sm[2][i]), h: r4(sm[3][i]), found: x[4]}));
  const track: FaceTrack = {fps, w: info.w, h: info.h, samples};
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(track));
  let longest = 0, run = 0;
  for (const x of raw) longest = Math.max(longest, (run = x[4] ? 0 : run + 1));
  return {track, stats: {samples: raw.length, foundShare: +(raw.filter((x) => x[4]).length / raw.length).toFixed(3), longestGapS: +(longest / fps).toFixed(2)}};
};
