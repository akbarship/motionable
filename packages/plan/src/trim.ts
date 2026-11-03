// Pause trimming from word timings (phase 0). Natural pauses per the style's rules: a sentence end keeps more
// air than a comma (Motionable lessons). Later this moves to real-silence detection with crossfades
// (Motionable tools/tighten_audio.py v2).
import type {Segment, StyleRules, Word} from './types';

export type TrimOptions = {
  from: number; // source seconds where the edit starts
  rules: StyleRules['timeline'];
  keepAfter?: number[]; // word ids whose following pause is kept whole
  natural?: boolean; // false: every trimmed pause keeps exactly `trimTo` (Motionable IMG_4765)
};

/** The pause kept after word `a` when the pause is trimmed. */
export const keptPause = (a: Word, rules: StyleRules['timeline'], natural = true) => {
  if (natural && rules.naturalPause) {
    if (/[.?!…]["»”]?$/.test(a.text)) return rules.naturalPause.afterSentence;
    if (/[,;:]$/.test(a.text)) return rules.naturalPause.afterComma;
  }
  return rules.trimTo;
};

export const trimPauses = (words: Word[], o: TrimOptions): Segment[] => {
  const keep = new Set(o.keepAfter ?? []);
  const ws = words.filter((w) => w.start >= o.from);
  const spans: [number, number][] = [];
  let cur = o.from;
  for (let k = 0; k < ws.length - 1; k++) {
    const [a, b] = [ws[k], ws[k + 1]];
    const gap = b.start - a.end;
    if (gap > o.rules.trimPausesOver && !keep.has(a.i)) {
      const half = Math.min(gap, keptPause(a, o.rules, o.natural ?? true)) / 2;
      spans.push([cur, a.end + half]);
      cur = b.start - half;
    }
  }
  spans.push([cur, ws[ws.length - 1].end + (o.rules.tail ?? 0.3)]);
  const crossfade = o.rules.crossfade;
  return spans.map(([s, e], id) => ({
    id,
    // not rounded: a word can sit exactly on a half-frame boundary, where rounding changes which frame it lands on
    in: s,
    out: e,
    ...(id > 0 && crossfade ? {join: {crossfade}} : {}),
  }));
};
