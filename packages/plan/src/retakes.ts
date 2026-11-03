// The retake rule (gemini-timeline.md §3, decision 2026-10-19): the director cuts a retake by itself only when it's
// sure. Sure means all three: Gemini lists it with confidence ≥ 0.8; the transcript shows the repeat (most of the
// dropped words also appear, in order, in the kept take, within 8 s); and the kept take ends on punctuation.
import type {Word} from './types';

export type GeminiRetake = {drop: [number, number]; keep: [number, number]; kind: string; confidence: number; why: string};

export type RetakeVerdict = {
  drop: [number, number];
  keep: [number, number];
  kind: string;
  sure: boolean;
  checks: {gemini: boolean; repeat: boolean; complete: boolean};
  evidence: string[];
  why: string;
};

export const RETAKE_MIN_CONFIDENCE = 0.8;
export const RETAKE_MAX_GAP_S = 8;
const MOST = 0.6; // "most of the dropped words"

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}ʻʼ]/gu, '');

/** Longest common subsequence length: are the dropped words found, in order, in the kept take? */
const lcs = (a: string[], b: string[]) => {
  const dp = Array.from({length: a.length + 1}, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  return dp[a.length][b.length];
};

export const judgeRetake = (r: GeminiRetake, words: Word[]): RetakeVerdict => {
  const span = ([a, b]: [number, number]) => words.slice(a, b + 1);
  const drop = span(r.drop);
  const keep = span(r.keep);
  const dropText = drop.map((w) => norm(w.text)).filter(Boolean);
  const keepText = keep.map((w) => norm(w.text)).filter(Boolean);
  const shared = dropText.length ? lcs(dropText, keepText) / dropText.length : 0;
  const gap = drop.length && keep.length
    ? Math.max(0, Math.max(drop[0].start, keep[0].start) - Math.min(drop[drop.length - 1].end, keep[keep.length - 1].end))
    : Infinity;
  const last = keep[keep.length - 1]?.text ?? '';
  const checks = {
    gemini: r.confidence >= RETAKE_MIN_CONFIDENCE,
    repeat: shared >= MOST && gap <= RETAKE_MAX_GAP_S,
    complete: /[,.?!…;:]["»”]?$/.test(last),
  };
  const evidence = [
    ...(checks.gemini ? [`gemini ${r.confidence}`] : []),
    ...(checks.repeat ? [`repeat ${Math.round(shared * 100)}%`] : []),
    ...(checks.complete ? ['keep ends on punctuation'] : []),
  ];
  return {drop: r.drop, keep: r.keep, kind: r.kind, sure: checks.gemini && checks.repeat && checks.complete, checks, evidence, why: r.why};
};
