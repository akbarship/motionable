// Source time ↔ output frames through the kept segments (edit-plan.md §8.1), and anchors → output frames (§3).
// The mapping is Motionable's resolve.ts, now driven by the plan's explicit segments.
import type {Anchor, Segment, Word} from './types';

export type OutSegment = {id: number; s: number; e: number; start: number; len: number}; // source s; output frames

export type TimelineMap = {
  fps: number;
  segments: OutSegment[];
  totalFrames: number;
  srcToFrame: (t: number) => number;
  frameToSrc: (f: number) => number;
  isKept: (t: number) => boolean;
};

export const buildTimeline = (segments: Segment[], fps: number): TimelineMap => {
  let start = 0;
  const out: OutSegment[] = segments.map((g) => {
    const len = Math.round((g.out - g.in) * fps);
    const seg = {id: g.id, s: g.in, e: g.out, start, len};
    start += len;
    return seg;
  });
  const totalFrames = start;

  /** A time inside a trimmed pause snaps to the next kept frame. */
  const srcToFrame = (t: number) => {
    for (const g of out) {
      if (t < g.s) return g.start;
      if (t < g.s + g.len / fps) return g.start + Math.round((t - g.s) * fps);
    }
    return totalFrames - 1;
  };
  const frameToSrc = (f: number) => {
    const g = out.find((x) => f < x.start + x.len) ?? out[out.length - 1];
    return g.s + (f - g.start) / fps;
  };
  const isKept = (t: number) => out.some((g) => t >= g.s && t < g.e);
  return {fps, segments: out, totalFrames, srcToFrame, frameToSrc, isKept};
};

export type ParsedAnchor =
  | {base: 'word'; n: number; end: boolean; offset: number; offsetUnit: 's' | 'f'}
  | {base: 't' | 'out'; s: number; offset: number; offsetUnit: 's' | 'f'}
  | {base: 'cut'; n: number; offset: number; offsetUnit: 's' | 'f'}
  | {base: 'shot'; id: string; end: boolean; offset: number; offsetUnit: 's' | 'f'}
  | {base: 'end'; offset: number; offsetUnit: 's' | 'f'};

const ANCHOR = /^(?:(word):(\d+)(\.end)?|(t|out):(\d+(?:\.\d+)?)|(cut):(\d+)|(shot):([A-Za-z0-9_]+?)(\.end)?|(end))(?:([+-])(\d+(?:\.\d+)?)(f?))?$/;

export const parseAnchor = (a: Anchor): ParsedAnchor => {
  const m = ANCHOR.exec(a);
  if (!m) throw new Error(`bad anchor "${a}"`);
  const sign = m[12] === '-' ? -1 : 1;
  const offset = m[13] ? sign * Number(m[13]) : 0;
  const offsetUnit = m[14] === 'f' ? 'f' : 's';
  if (m[1]) return {base: 'word', n: Number(m[2]), end: !!m[3], offset, offsetUnit};
  if (m[4]) return {base: m[4] as 't' | 'out', s: Number(m[5]), offset, offsetUnit};
  if (m[6]) return {base: 'cut', n: Number(m[7]), offset, offsetUnit};
  if (m[8]) return {base: 'shot', id: m[9], end: !!m[10], offset, offsetUnit};
  return {base: 'end', offset, offsetUnit};
};

export type AnchorContext = {
  map: TimelineMap;
  words: Word[];
  anchorLead: number; // seconds: `word:N` lands this much before the word (Motionable: 0.05 s)
  shot?: (id: string, end: boolean) => number;
};

/**
 * Anchor → output frame. Offsets apply on the output, after the base is placed:
 * `word:89+2f` is two frames after word 89 lands.
 */
export const resolveAnchor = (a: Anchor, ctx: AnchorContext): number => {
  const p = parseAnchor(a);
  const {map} = ctx;
  let base: number;
  switch (p.base) {
    case 'word': {
      const w = ctx.words[p.n];
      if (!w) throw new Error(`anchor "${a}": no word ${p.n}`);
      base = p.end ? map.srcToFrame(w.end) : map.srcToFrame(w.start - ctx.anchorLead);
      break;
    }
    case 't':
      base = map.srcToFrame(p.s);
      break;
    case 'out':
      base = Math.round(p.s * map.fps);
      break;
    case 'cut': {
      const g = map.segments.find((x) => x.id === p.n); // by id, so anchors survive merges and cuts
      if (!g) throw new Error(`anchor "${a}": no segment ${p.n}`);
      base = g.start;
      break;
    }
    case 'shot':
      if (!ctx.shot) throw new Error(`anchor "${a}": shot anchors aren't allowed here`);
      base = ctx.shot(p.id, p.end);
      break;
    case 'end':
      base = map.totalFrames;
      break;
  }
  const off = p.offsetUnit === 'f' ? p.offset : Math.round(p.offset * map.fps);
  return base + off;
};

/** Seconds, or "26f", → frames. */
export const toFrames = (d: number | string, fps: number): number => {
  if (typeof d === 'number') return Math.round(d * fps);
  const m = /^(\d+(?:\.\d+)?)f$/.exec(d);
  if (m) return Math.round(Number(m[1]));
  const n = Number(d);
  if (Number.isFinite(n)) return Math.round(n * fps);
  throw new Error(`bad duration "${d}"`);
};
