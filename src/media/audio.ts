import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SR = 16_000;
const HOP = 160; // 10 ms

/** Mono 16 kHz signed 16-bit PCM of a media file (first `maxS` seconds). */
export function decodePcm(file: string, maxS = 180): Promise<Int16Array> {
  return new Promise((ok, fail) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-t', String(maxS), '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let err = '';
    ff.stdout.on('data', (d: Buffer) => chunks.push(d));
    ff.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-1000)));
    ff.once('error', fail);
    ff.once('close', (code) => {
      if (code !== 0) return fail(new Error(`ffmpeg failed: ${err.trim().split('\n').pop() ?? code}`));
      const buf = Buffer.concat(chunks);
      ok(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)));
    });
  });
}

export interface Hit {
  /** Onset time, seconds. */
  t: number;
  /** Seconds until the level falls back near the bed. */
  dur: number;
  /** Rise over the preceding bed, dB. */
  rise: number;
  /** Brightness estimate from zero crossings, Hz. */
  centroid: number;
  /** Guess: click (short, bright), impact (low), whoosh (long swell), hit (other). */
  kind: 'click' | 'impact' | 'whoosh' | 'hit';
}

/**
 * Sudden level jumps in a 10 ms energy track: candidate sound effects. Speech onsets show up too,
 * so the caller matches hits to on-screen events (cuts, cards appearing) before calling them SFX.
 */
export function findHits(pcm: Int16Array, opts: { minRise?: number; floorDb?: number; max?: number } = {}): Hit[] {
  const minRise = opts.minRise ?? 9;
  const floorDb = opts.floorDb ?? -42;
  const n = Math.floor(pcm.length / HOP);
  const db = new Float64Array(n);
  const zcr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let z = 0;
    for (let j = i * HOP; j < (i + 1) * HOP; j++) {
      const v = pcm[j] / 32768;
      sum += v * v;
      if (j > i * HOP && (pcm[j] >= 0) !== (pcm[j - 1] >= 0)) z++;
    }
    db[i] = 10 * Math.log10(sum / HOP + 1e-12);
    zcr[i] = (z * SR) / (2 * HOP);
  }
  const BED = 30; // 300 ms of history
  const hits: Hit[] = [];
  let i = BED;
  while (i < n) {
    const hist = Array.from(db.subarray(i - BED, i)).sort((a, b) => a - b);
    const bed = hist[Math.floor(hist.length / 2)];
    const rise = db[i] - bed;
    if (db[i] > floorDb && rise >= minRise) {
      let peak = i;
      for (let k = i; k < Math.min(n, i + 8); k++) if (db[k] > db[peak]) peak = k;
      let end = peak;
      while (end < n - 1 && end - i < 200 && db[end] > bed + 3) end++;
      let zsum = 0;
      for (let k = i; k <= end; k++) zsum += zcr[k];
      const centroid = Math.round(zsum / (end - i + 1));
      const dur = Math.round(((end - i + 1) * HOP * 1000) / SR) / 1000;
      const attack = (peak - i) * 0.01;
      const kind: Hit['kind'] =
        dur >= 0.4 && attack >= 0.05 ? 'whoosh' : centroid < 900 ? 'impact' : dur <= 0.25 && centroid > 2500 ? 'click' : 'hit';
      hits.push({ t: Math.round(i * HOP * 1000 / SR) / 1000, dur, rise: Math.round(rise * 10) / 10, centroid, kind });
      i = Math.max(end, i + 12); // 120 ms refractory
    } else i++;
  }
  const max = opts.max ?? 40;
  if (hits.length <= max) return hits;
  return [...hits].sort((a, b) => b.rise - a.rise).slice(0, max).sort((a, b) => a.t - b.t);
}

export interface Silence {
  start: number;
  end: number;
}

/** ffmpeg silencedetect: quiet stretches of at least `minS` below `noiseDb`. */
export async function findSilences(file: string, noiseDb = -35, minS = 0.25): Promise<{ duration: number; silences: Silence[] }> {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${noiseDb}dB:d=${minS}`, '-f', 'null', '-'], {
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return parseSilences(stderr);
}

/** Parses silencedetect output; an open silence at the end runs to the file duration. */
export function parseSilences(stderr: string): { duration: number; silences: Silence[] } {
  const dm = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0;
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = /silence_start: (-?\d+(?:\.\d+)?)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = /silence_end: (\d+(?:\.\d+)?)/.exec(line);
    if (e && open !== null) {
      silences.push({ start: round(open), end: round(Number(e[1])) });
      open = null;
    }
  }
  if (open !== null && duration > open) silences.push({ start: round(open), end: round(duration) });
  return { duration: round(duration), silences };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
