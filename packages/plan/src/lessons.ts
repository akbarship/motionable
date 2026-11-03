// Lessons: the user's rejections, kept so the same mistake doesn't come back (CLAUDE.md rule 2). A lesson with a
// `rule` is checked on every batch: a batch that adds a new breach is rejected with the user's own words. Lessons
// without one are reminders in get_project_state.
import type {EditPlan} from './types';
import type {ResolvedPlan} from './resolved';

export type LessonRule =
  | {kind: 'forbid'; component: string}
  | {kind: 'max_per_minute'; what: string; n: number} // 'shot' | 'overlay' | 'transition' | a component ref
  | {kind: 'min_hold'; role: string; s: number}
  | {kind: 'no_behind_subject'};

export type Lesson = {
  id: string;
  scope: string; // 'global' | 'style:<name>'
  text: string; // the user's words, one sentence
  rule?: LessonRule;
  source?: string;
  seen?: number; // batches it has stopped
  last?: string;
  at: string;
};

/** One breach: `key` names it, so a breach the plan already had isn't held against the next batch. */
export type Breach = {lesson: Lesson; key: string; detail: string};

/** The lessons that apply to a plan in this style. */
export const lessonsFor = (all: Lesson[], style: string) => {
  const name = style.split('@')[0];
  return all.filter((l) => l.scope === 'global' || l.scope === `style:${name}`);
};

const usesOf = (plan: EditPlan, ref: string) => [
  ...plan.overlays.filter((o) => o.component === ref).map((o) => `overlay ${o.id}`),
  ...plan.transitions.filter((t) => t.component === ref).map((t) => `transition ${t.id}`),
  ...plan.captions.lines.filter((l) => !l.hidden && l.component === ref).map((l) => `caption line ${l.id}`),
  ...plan.shots.filter((s) => s.captions?.component === ref || s.scene?.component === ref).map((s) => `shot ${s.id}`),
  ...(plan.captions.component === ref ? ['the video captions'] : []),
];

/** Every breach of the lessons' rules in a plan. */
export const breaches = (lessons: Lesson[], plan: EditPlan, r: ResolvedPlan): Breach[] => {
  const out: Breach[] = [];
  const fps = r.canvas.fps;
  const minutes = Math.max(1 / 60, r.totalFrames / fps / 60);
  for (const lesson of lessons) {
    const rule = lesson.rule;
    if (!rule) continue;
    const add = (key: string, detail: string) => out.push({lesson, key: `${lesson.id}:${key}`, detail});
    if (rule.kind === 'forbid') {
      for (const u of usesOf(plan, rule.component)) add(u, `${u} uses ${rule.component}`);
    } else if (rule.kind === 'no_behind_subject') {
      for (const o of plan.overlays) if (o.depth === 'behind-subject') add(o.id, `overlay ${o.id} is behind the speaker`);
    } else if (rule.kind === 'max_per_minute') {
      const n = rule.what === 'shot' ? plan.shots.length : rule.what === 'overlay' ? plan.overlays.length
        : rule.what === 'transition' ? plan.transitions.length : usesOf(plan, rule.what).length;
      const rate = n / minutes;
      // the count, not the rate, is the key: one more is a new breach, an unchanged count is the old one
      if (rate > rule.n) add(`${rule.what}:${n}`, `${n} × ${rule.what} is ${rate.toFixed(1)} a minute (max ${rule.n})`);
    } else if (rule.kind === 'min_hold') {
      for (const b of r.captionBlocks) {
        const end = Math.min(b.until, b.hardEnd);
        b.lines.forEach((l, i) => {
          if (l.role !== rule.role || !l.words.length) return;
          const from = l.words[0].start;
          const to = i + 1 < b.lines.length && b.lines[i + 1].words.length ? b.lines[i + 1].words[0].start : end;
          const hold = (to - from) / fps;
          if (hold < rule.s - 1e-6) add(l.id, `${rule.role} line ${l.id} shows for ${hold.toFixed(2)} s (min ${rule.s} s)`);
        });
      }
    }
  }
  return out;
};

/** The rejection text: the user's own words first, then what broke them. */
export const breachMessage = (b: Breach) => `[lesson:${b.lesson.id}] "${b.lesson.text}" (${b.detail})`;
