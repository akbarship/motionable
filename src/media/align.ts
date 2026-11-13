import type { Words } from '../core/types.js';

/** Lowercase, one apostrophe for o'/g' (ʻ ’ ` ‘), no punctuation. */
export function norm(t: string): string {
  return t
    .toLowerCase()
    .replace(/[ʻʼ’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/(^|\s)'+|'+(\s|$)/g, ' ')
    .trim();
}

const tokens = (t: string) => norm(t).split(/\s+/).filter(Boolean);

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 0..1 similarity of two words (STT spelling slips count as a match). */
export function wordSim(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - lev(a, b) / Math.max(a.length, b.length);
}

/** Script lines: sentences (. ! ?) and line breaks; empty and heading-only lines dropped. */
export function scriptLines(script: string): string[] {
  return script
    .split(/\n+|(?<=[.!?])\s+/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => tokens(l).length > 0);
}

export interface Source {
  src: string;
  words: Words;
}

export interface Take {
  src: string;
  /** Seconds in `src`: first and last matched word. */
  start: number;
  end: number;
  /** Matched script words / script words. */
  coverage: number;
  /** Word index range in the source's words. */
  from: number;
  to: number;
}

export interface LineMatch {
  line: string;
  takes: Take[];
  /** The take to keep: the last one that is near-complete (coverage within 0.1 of the best, >= 0.6). */
  pick: Take | null;
}

const MATCH = 0.7;

/** Best alignment of the whole line inside words[i..i+win): DP, line fully, words with free ends. */
function alignAt(line: string[], w: string[], i: number, win: number): { score: number; matched: number; end: number; first: number } {
  const n = Math.min(win, w.length - i);
  const m = line.length;
  // score[j][k], matched counts, first matched word index
  let prev = Array.from({ length: n + 1 }, () => ({ s: 0, mt: 0, first: -1 }));
  for (let j = 1; j <= m; j++) {
    const cur = [{ s: prev[0].s - 1, mt: prev[0].mt, first: prev[0].first }];
    for (let k = 1; k <= n; k++) {
      const sim = wordSim(line[j - 1], w[i + k - 1]);
      const diag = prev[k - 1].s + (sim >= MATCH ? 2 : -1);
      const up = prev[k].s - 1; // script word not spoken
      const left = cur[k - 1].s - 1; // extra spoken word (filler, slip)
      if (diag >= up && diag >= left) {
        const hit = sim >= MATCH;
        const first = prev[k - 1].first >= 0 ? prev[k - 1].first : hit ? i + k - 1 : -1;
        cur.push({ s: diag, mt: prev[k - 1].mt + (hit ? 1 : 0), first });
      } else if (up >= left) cur.push({ ...prev[k], s: up });
      else cur.push({ ...cur[k - 1], s: left });
    }
    prev = cur;
  }
  let best = 0;
  for (let k = 1; k <= n; k++) if (prev[k].s > prev[best].s) best = k;
  return { score: prev[best].s, matched: prev[best].mt, end: i + best - 1, first: prev[best].first };
}

/**
 * Finds every take of every script line across the sources (several voiceovers or clips),
 * and picks the last near-complete take of each line: people re-say a line after a slip.
 */
export function alignScript(script: string, sources: Source[]): LineMatch[] {
  const lines = scriptLines(script);
  const prepared = sources.map((s) => ({ ...s, toks: s.words.map((x) => norm(x.w).replace(/\s+/g, '')) }));
  return lines.map((line) => {
    const lt = tokens(line);
    const takes: Take[] = [];
    for (const s of prepared) {
      const win = Math.ceil(lt.length * 1.6) + 3;
      const cands: Take[] = [];
      const starts: number[] = [];
      for (let i = 0; i < s.toks.length; i++) {
        // A take starts on one of the line's first words.
        if (lt.slice(0, 3).some((t) => wordSim(t, s.toks[i]) >= MATCH)) starts.push(i);
      }
      const full = new Map(starts.map((i) => [i, alignAt(lt, s.toks, i, win)]));
      for (const i of starts) {
        let r = full.get(i)!;
        // A take that runs into a better restart of the same line ends where the restart begins
        // ("claude uni har sessa ... claude uni har sessiyada o'zi o'qiydi" = two takes).
        const restart = starts.find((j) => j > i && j <= r.end && full.get(j)!.matched >= r.matched && wordSim(s.toks[j], s.toks[i]) >= MATCH);
        if (restart !== undefined) r = alignAt(lt, s.toks, i, restart - i);
        if (r.first < 0 || r.end < r.first) continue;
        const coverage = r.matched / lt.length;
        if (coverage < 0.5) continue;
        cands.push({ src: s.src, start: s.words[r.first].start, end: s.words[r.end].end, coverage: Math.round(coverage * 100) / 100, from: r.first, to: r.end });
      }
      // Overlapping candidates are one take: keep the best covered (then the longest).
      cands.sort((a, b) => b.coverage - a.coverage || b.to - b.from - (a.to - a.from));
      for (const c of cands) if (!takes.some((t) => t.src === c.src && c.from <= t.to && t.from <= c.to)) takes.push(c);
    }
    const order = (t: Take) => sources.findIndex((s) => s.src === t.src) * 1e6 + t.start;
    takes.sort((a, b) => order(a) - order(b));
    const best = Math.max(0, ...takes.map((t) => t.coverage));
    const good = takes.filter((t) => t.coverage >= Math.max(0.6, best - 0.1));
    return { line, takes, pick: good.length > 0 ? good[good.length - 1] : null };
  });
}
