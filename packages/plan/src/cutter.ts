// Cut candidates from the transcript alone: restarts (retakes) and Uzbek fillers. The cutter only proposes;
// Claude cuts the sure ones with range.cut and leaves the rest as range.suggest for the user. Every candidate
// carries its evidence, so each cut in the plan has a reason.
import type {Word} from './types';

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}ʻʼ]/gu, '');

/** Sounds, not words: safe to cut. "haligi" is the Uzbek "um". */
export const UZ_FILLERS = new Set(['e', 'ee', 'eee', 'eh', 'ehh', 'aa', 'aaa', 'mm', 'mmm', 'hmm', 'hm', 'uh', 'um', 'haligi']);
/** Words that are often filler but can carry meaning: suggested only, never cut by the system. */
export const UZ_MARKERS = new Set(['xullas', 'demak', 'mana', 'aslida', 'yaʼni', 'qisqasi', 'shunaqa', 'umuman']);

const HELD_VOWEL_S = 1.2; // a "filler" this long is a held word the speaker meant (ffmpeg-skill)
const RETAKE_MAX_GAP_S = 10; // the restart comes within 10 s of the attempt's first word
const RETAKE_MAX_DROP = 30; // words in a dropped attempt (a whole sentence said again can be long)
const MIN_MATCH = 2; // words that must repeat in order for a broken-off attempt (1 for a stutter "men men")
const MIN_MATCH_SENTENCE = 3; // a finished sentence counts as an attempt only when 3+ words open the retake again

export type Candidate = {
  kind: 'retake' | 'filler';
  from: string; // anchors for range.cut / range.suggest
  to: string;
  text: string; // what would go
  sure: boolean;
  evidence: string[];
};

const endsClause = (t: string) => /[,.?!…;:]["»”]?$/.test(t);

const endsSentence = (t: string) => /[.?!…]["»”]?$/.test(t);

/**
 * Retakes: a run of words said again, in order, shortly after; the earlier attempt is dropped. Two shapes:
 * - broken off: "Bugun men sizga — bugun men sizga uchta…" (2+ words repeat, or a stutter "men men");
 * - a whole sentence said again: "Ikkinchi skill esa sizni oʻzingiz. Ikkinchi skill esa sizni…". Speech repeats
 *   sentence openings too ("Pul bor. Pul bor ekan"), so this needs 3+ repeated words and the retake must start a
 *   sentence; a one-word sentence ("Toʻrtinchi.") followed by a sentence opening with it counts as well.
 */
const retakes = (words: Word[]): Candidate[] => {
  const n = words.map((w) => norm(w.text));
  const sentenceStart = (k: number) => k === 0 || endsSentence(words[k - 1].text);
  const out: Candidate[] = [];
  let i = 0;
  while (i < words.length) {
    let found: Candidate | null = null;
    for (let j = i + 1; j < words.length && j - i <= RETAKE_MAX_DROP && words[j].start - words[i].start <= RETAKE_MAX_GAP_S; j++) {
      if (!n[i] || n[j] !== n[i]) continue;
      let m = 0;
      while (j + m < words.length && i + m < j && n[i + m] && n[i + m] === n[j + m]) m++;
      const dropped = words.slice(i, j);
      const finished = dropped.some((w) => endsSentence(w.text));
      const oneWord = j === i + 1;
      let ok: boolean;
      let sure: boolean;
      const keepEnd = words.slice(j, j + 40).findIndex((w) => endsClause(w.text));
      const complete = keepEnd >= 0;
      if (!finished) {
        ok = m >= MIN_MATCH || (oneWord && m >= 1); // broken off, or a stutter
        sure = (oneWord && m >= 1) || (m >= 3 && complete) || (m >= MIN_MATCH && complete && j - i <= m + 2);
      } else {
        ok = sentenceStart(j) && (m >= MIN_MATCH_SENTENCE || (oneWord && m >= 1));
        sure = ok && complete && (m >= 4 || (oneWord && m >= 1));
      }
      if (!ok) continue;
      found = {
        kind: 'retake', from: `word:${i}`, to: `word:${j - 1}.end`, text: dropped.map((w) => w.text).join(' '), sure,
        evidence: [
          oneWord && m >= 1 && !finished ? 'stutter' : `${finished ? 'sentence said again' : 'restart'}: ${m} words repeat`,
          complete ? 'the retake finishes the clause' : 'the retake has no clause end',
        ],
      };
      break;
    }
    if (found) {
      out.push(found);
      i = Number(found.to.slice(5, -4)) + 1;
    } else i++;
  }
  return out;
};

const fillers = (words: Word[]): Candidate[] => {
  const out: Candidate[] = [];
  for (const w of words) {
    const t = norm(w.text);
    const dur = w.end - w.start;
    const pure = UZ_FILLERS.has(t);
    if (!pure && !UZ_MARKERS.has(t)) continue;
    if (pure && dur > HELD_VOWEL_S) continue;
    out.push({
      kind: 'filler', from: `word:${w.i}`, to: `word:${w.i}.end`, text: w.text, sure: pure,
      evidence: [pure ? 'filler sound' : 'discourse marker: may carry meaning', ...(w.conf !== undefined && w.conf < 0.5 ? [`low confidence ${w.conf}`] : [])],
    });
  }
  return out;
};

/** Candidates over the kept words only (already cut words are skipped); anchors use transcript indices. */
export const proposeCuts = (words: Word[], isKept: (t: number) => boolean = () => true): Candidate[] => {
  const kept = words.filter((w) => isKept(w.start));
  const local = kept.map((w, k) => ({...w, i: k})); // consecutive, so a cut word doesn't break a repeat
  const toGlobal = (a: string) => a.replace(/word:(\d+)/, (_, k) => `word:${kept[Number(k)].i}`);
  return [...retakes(local), ...fillers(local)]
    .map((c) => ({...c, from: toGlobal(c.from), to: toGlobal(c.to)}))
    .sort((a, b) => Number(a.from.slice(5)) - Number(b.from.slice(5)));
};
