// Plan operations (edit-plan.md §9). A batch is all-or-nothing: each op is applied to the result of the ones before,
// and the result must validate. Ops are semantic, so the history is readable (and is the taste signal).
import type {Batch, CameraMode, CaptionLine, EditPlan, Note, Op, Overlay, Range, Segment, Sfx, Shot, Transition} from './types';
import {keptPause} from './trim';
import {parseAnchor} from './timeline';
import {validatePlan, type Issue} from './validate';
import {resolvePlan, wordsOf, type ResolveInput} from './resolve';
import {breachMessage, breaches, type Breach, type Lesson} from './lessons';

export class OpError extends Error {
  constructor(public index: number, public op: Op, message: string) {
    super(`op ${index} (${op.op}): ${message}`);
  }
}

export type ApplyContext = Omit<ResolveInput, 'plan'> & {owner?: string | null; lessons?: Lesson[]};

/** A batch that would break a lesson again: the user's words, and which lessons (so their counters move). */
export class LessonError extends Error {
  constructor(public breaches: Breach[]) {
    super(`the batch breaks what the user said before:\n${breaches.slice(0, 6).map(breachMessage).join('\n')}`);
  }
}
export type ApplyResult = {plan: EditPlan; warnings: Issue[]; rebased: boolean};

const clone = <T>(v: T): T => structuredClone(v);
const str = (op: Op, k: string) => {
  const v = op[k];
  if (typeof v !== 'string') throw new Error(`"${k}" must be a string`);
  return v;
};
const num = (op: Op, k: string) => {
  const v = op[k];
  if (typeof v !== 'number') throw new Error(`"${k}" must be a number`);
  return v;
};
const obj = <T = Record<string, unknown>>(op: Op, k: string) => {
  const v = op[k];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`"${k}" must be an object`);
  return v as T;
};
const findIndex = <T extends {id: string}>(list: T[], id: string, what: string) => {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`no ${what} "${id}"`);
  return i;
};
const update = <T extends {id: string}>(list: T[], id: string, what: string, set: Record<string, unknown>) => {
  if ('id' in set) throw new Error("an id can't be changed");
  const i = findIndex(list, id, what);
  list[i] = {...list[i], ...set};
};
const nextSegmentId = (segs: Segment[]) => Math.max(...segs.map((g) => g.id)) + 1;

/** Source seconds of an anchor used in a range (word starts/ends or t:). */
const rangeTime = (a: string, ctx: ApplyContext, plan: EditPlan, edge: 'start' | 'end') => {
  const p = parseAnchor(a);
  const words = wordsOf(plan, ctx.transcript);
  if (p.base === 'word') {
    const w = words[p.n];
    if (!w) throw new Error(`no word ${p.n}`);
    return p.end || edge === 'end' ? w.end : w.start;
  }
  if (p.base === 't') return p.s;
  throw new Error(`ranges take word: or t: anchors, not "${a}"`);
};

/** The source span a range removes: from the middle of the pause before it to the middle of the pause after it. */
const rangeSpan = (r: {from: string; to: string}, plan: EditPlan, ctx: ApplyContext): [number, number] => {
  const words = wordsOf(plan, ctx.transcript);
  const s = rangeTime(r.from, ctx, plan, 'start');
  const e = rangeTime(r.to, ctx, plan, 'end');
  if (e <= s) throw new Error('the range ends before it starts');
  const half = ctx.style.rules.timeline.trimTo / 2;
  const prev = [...words].reverse().find((w) => w.end <= s);
  const next = words.find((w) => w.start >= e);
  return [prev ? Math.min(s, prev.end + half) : s, next ? Math.max(e, next.start - half) : e];
};

/** Remove a source span from the kept segments. Returns the new segments and exactly what was removed. */
const cutSpan = (segs: Segment[], [s, e]: [number, number]) => {
  const out: Segment[] = [];
  const removed: [number, number][] = [];
  let nextId = nextSegmentId(segs);
  for (const g of segs) {
    if (g.out <= s || g.in >= e) out.push(g);
    else {
      removed.push([Math.max(g.in, s), Math.min(g.out, e)]);
      if (g.in < s) out.push({...g, out: s});
      if (g.out > e) out.push(g.in < s ? {id: nextId++, in: e, out: g.out} : {...g, in: e});
    }
  }
  return {segments: out, removed};
};

/** Add source spans back, merging only spans that touch. A merged segment keeps the older (smaller) id. */
const addSpans = (segs: Segment[], spans: [number, number][]): Segment[] => {
  let id = nextSegmentId(segs);
  const all = [...segs, ...spans.map(([s, e]) => ({id: id++, in: s, out: e}))].sort((a, b) => a.in - b.in);
  const out: Segment[] = [];
  for (const g of all) {
    const last = out[out.length - 1];
    if (last && g.in <= last.out + 1e-9) {
      last.out = Math.max(last.out, g.out);
      if (g.id < last.id) last.id = g.id;
    } else out.push({...g});
  }
  return out;
};

const keptWords = (plan: EditPlan, ctx: ApplyContext) => {
  const words = wordsOf(plan, ctx.transcript);
  return words.filter((w) => plan.timeline.segments.some((g) => w.start >= g.in && w.start < g.out)).map((w) => w.i);
};

/** After the timeline changes: drop cut words from caption lines, and give restored words a line of their own. */
const syncCaptions = (plan: EditPlan, ctx: ApplyContext) => {
  const kept = new Set(keptWords(plan, ctx));
  const lines = plan.captions.lines
    .map((l) => ({...l, words: l.words.filter((i) => kept.has(i))}))
    .filter((l) => l.words.length > 0);
  const covered = new Set(lines.flatMap((l) => l.words));
  const missing = [...kept].filter((i) => !covered.has(i)).sort((a, b) => a - b);
  let n = 0;
  const ids = new Set(lines.map((l) => l.id));
  for (const i of missing) {
    let id: string;
    do id = `r${++n}`;
    while (ids.has(id));
    ids.add(id);
    lines.push({id, words: [i], role: 'cap'});
  }
  lines.sort((a, b) => a.words[0] - b.words[0]);
  plan.captions.lines = lines;
};

const applyOp = (plan: EditPlan, op: Op, ctx: ApplyContext, byKind: string) => {
  const words = () => wordsOf(plan, ctx.transcript);
  switch (op.op) {
    // ---------- words ----------
    case 'word.setText': {
      const i = num(op, 'word');
      const text = str(op, 'text');
      const ws = words();
      if (!ws[i]) throw new Error(`no word ${i}`);
      const targets = op.scope === 'same' ? ws.filter((w) => w.text === ws[i].text).map((w) => w.i) : [i];
      for (const t of targets) plan.transcript.edits[String(t)] = text;
      return;
    }
    // ---------- timeline ----------
    case 'pause.keep': {
      const a = num(op, 'afterWord');
      const ws = words();
      const w = ws[a];
      const b = ws[a + 1];
      if (!w || !b) throw new Error(`no pause after word ${a}`);
      const segs = plan.timeline.segments;
      const k = segs.findIndex((g, j) => g.out <= b.start && g.out >= w.end && segs[j + 1] && segs[j + 1].in <= b.start + 1e-6);
      if (k < 0) throw new Error(`the pause after word ${a} isn't trimmed`);
      segs[k] = {...segs[k], out: segs[k + 1].out};
      segs.splice(k + 1, 1);
      return;
    }
    case 'pause.trim': {
      const a = num(op, 'afterWord');
      const ws = words();
      const w = ws[a];
      const b = ws[a + 1];
      if (!w || !b) throw new Error(`no pause after word ${a}`);
      const segs = plan.timeline.segments;
      const k = segs.findIndex((g) => g.in <= w.end && g.out >= b.start);
      if (k < 0) throw new Error(`the pause after word ${a} is already trimmed`);
      const half = Math.min(b.start - w.end, keptPause(w, ctx.style.rules.timeline)) / 2;
      const g = segs[k];
      segs.splice(k, 1, {...g, out: w.end + half}, {id: nextSegmentId(segs), in: b.start - half, out: g.out});
      return;
    }
    case 'segment.set': {
      const id = num(op, 'id');
      const g = plan.timeline.segments.find((x) => x.id === id);
      if (!g) throw new Error(`no segment ${id}`);
      if (typeof op.in === 'number') g.in = op.in;
      if (typeof op.out === 'number') g.out = op.out;
      if (typeof op.crossfade === 'number') g.join = {crossfade: op.crossfade};
      syncCaptions(plan, ctx);
      return;
    }
    case 'range.cut': {
      const r: Range = {from: str(op, 'from'), to: str(op, 'to'), kind: (op.kind as Range['kind']) ?? 'other', by: byKind,
        ...(Array.isArray(op.evidence) ? {evidence: op.evidence as string[]} : {}), ...(op.why ? {why: String(op.why)} : {})};
      const {segments, removed} = cutSpan(plan.timeline.segments, rangeSpan(r, plan, ctx));
      if (!removed.length) throw new Error('nothing kept in that range');
      plan.timeline.segments = segments;
      plan.timeline.removed.push({...r, cut: removed});
      plan.timeline.suggested = plan.timeline.suggested.filter((x) => !(x.from === r.from && x.to === r.to));
      syncCaptions(plan, ctx);
      return;
    }
    case 'range.restore': {
      const from = str(op, 'from');
      const to = str(op, 'to');
      const i = plan.timeline.removed.findIndex((x) => x.from === from && x.to === to);
      if (i < 0) throw new Error(`no removed range ${from}–${to}`);
      plan.timeline.segments = addSpans(plan.timeline.segments, plan.timeline.removed[i].cut ?? [rangeSpan({from, to}, plan, ctx)]);
      plan.timeline.removed.splice(i, 1);
      syncCaptions(plan, ctx);
      return;
    }
    case 'range.suggest':
      plan.timeline.suggested.push({from: str(op, 'from'), to: str(op, 'to'), kind: (op.kind as Range['kind']) ?? 'other',
        ...(op.why ? {why: String(op.why)} : {})});
      return;
    case 'range.dismiss': {
      const n = plan.timeline.suggested.length;
      plan.timeline.suggested = plan.timeline.suggested.filter((x) => !(x.from === op.from && x.to === op.to));
      if (plan.timeline.suggested.length === n) throw new Error(`no suggested range ${String(op.from)}–${String(op.to)}`);
      return;
    }
    // ---------- shots ----------
    case 'shot.insert': {
      const shot = obj<Shot>(op, 'shot');
      const at = op.after == null ? 0 : findIndex(plan.shots, String(op.after), 'shot') + 1;
      if (at === 0) throw new Error('a shot can only be inserted after another one');
      plan.shots.splice(at, 0, shot);
      return;
    }
    case 'shot.update':
      update(plan.shots, str(op, 'id'), 'shot', obj(op, 'set'));
      return;
    case 'shot.remove': {
      const i = findIndex(plan.shots, str(op, 'id'), 'shot');
      if (i === 0) throw new Error("the first shot can't be removed");
      const id = plan.shots[i].id;
      plan.shots.splice(i, 1);
      plan.transitions = plan.transitions.filter((x) => x.shot !== id);
      return;
    }
    case 'shot.move': {
      const i = findIndex(plan.shots, str(op, 'id'), 'shot');
      if (i === 0) throw new Error("the first shot always starts at cut:0");
      plan.shots[i] = {...plan.shots[i], from: str(op, 'from')};
      return;
    }
    // ---------- captions ----------
    case 'caption.split': {
      const i = findIndex(plan.captions.lines, str(op, 'line'), 'caption line');
      const at = num(op, 'atWord');
      const l = plan.captions.lines[i];
      const k = l.words.indexOf(at);
      if (k <= 0) throw new Error(`word ${at} isn't inside line ${l.id}`);
      const id = typeof op.id === 'string' ? op.id : `${l.id}b`;
      plan.captions.lines.splice(i, 1, {...l, words: l.words.slice(0, k)}, {...clone(l), id, words: l.words.slice(k)});
      return;
    }
    case 'caption.merge': {
      const ids = op.lines as string[];
      if (!Array.isArray(ids) || ids.length < 2) throw new Error('"lines" must list at least two lines');
      const idx = ids.map((id) => findIndex(plan.captions.lines, id, 'caption line'));
      for (let j = 1; j < idx.length; j++) {
        if (idx[j] !== idx[j - 1] + 1) throw new Error('only neighbouring lines can be merged');
      }
      const first = plan.captions.lines[idx[0]];
      const merged: CaptionLine = {...first, words: idx.flatMap((v) => plan.captions.lines[v].words)};
      plan.captions.lines.splice(idx[0], idx.length, merged);
      return;
    }
    case 'caption.setRole':
      update(plan.captions.lines, str(op, 'line'), 'caption line', {role: str(op, 'role')});
      return;
    case 'caption.hide':
      update(plan.captions.lines, str(op, 'line'), 'caption line', {hidden: op.hidden !== false});
      return;
    case 'caption.setStyle':
      update(plan.captions.lines, str(op, 'line'), 'caption line', {style: obj(op, 'style')});
      return;
    case 'caption.setComponent':
    case 'caption.setProps': {
      const scope = str(op, 'scope');
      const setComponent = op.op === 'caption.setComponent';
      const props = (op.props as Record<string, unknown> | undefined) ?? (setComponent ? {} : undefined);
      if (!setComponent && !props) throw new Error('"props" is required');
      if (scope === 'video') {
        if (setComponent) plan.captions.component = str(op, 'component');
        plan.captions.props = props;
      } else if (scope === 'shot') {
        const i = findIndex(plan.shots, str(op, 'target'), 'shot');
        const cur = plan.shots[i].captions;
        if (!setComponent && !cur) throw new Error(`shot ${plan.shots[i].id} has no caption component of its own`);
        plan.shots[i] = {...plan.shots[i], captions: {component: setComponent ? str(op, 'component') : cur!.component, props}};
      } else if (scope === 'line') {
        const i = findIndex(plan.captions.lines, str(op, 'target'), 'caption line');
        const cur = plan.captions.lines[i];
        if (!setComponent && !cur.component) throw new Error(`line ${cur.id} has no caption component of its own`);
        plan.captions.lines[i] = {...cur, component: setComponent ? str(op, 'component') : cur.component, props};
      } else throw new Error(`scope must be video, shot or line, not "${scope}"`);
      return;
    }
    // ---------- overlays, transitions, sound ----------
    case 'overlay.add': {
      const o = obj<Overlay>(op, 'overlay');
      const at = typeof op.index === 'number' ? op.index : plan.overlays.length;
      plan.overlays.splice(at, 0, o);
      return;
    }
    case 'overlay.update': {
      const id = str(op, 'id');
      update(plan.overlays, id, 'overlay', (op.set as Record<string, unknown>) ?? {});
      if (op.props) {
        const i = findIndex(plan.overlays, id, 'overlay');
        plan.overlays[i] = {...plan.overlays[i], props: {...(plan.overlays[i].props ?? {}), ...obj(op, 'props')}};
      }
      return;
    }
    case 'overlay.retime': {
      const set: Record<string, unknown> = {};
      if (op.from) set.from = str(op, 'from');
      if (op.to) set.to = str(op, 'to');
      update(plan.overlays, str(op, 'id'), 'overlay', set);
      return;
    }
    case 'overlay.remove':
      plan.overlays.splice(findIndex(plan.overlays, str(op, 'id'), 'overlay'), 1);
      return;
    case 'transition.add':
      plan.transitions.push(obj<Transition>(op, 'transition'));
      return;
    case 'transition.update': {
      const id = str(op, 'id');
      update(plan.transitions, id, 'transition', (op.set as Record<string, unknown>) ?? {});
      if (op.props) {
        const i = findIndex(plan.transitions, id, 'transition');
        plan.transitions[i] = {...plan.transitions[i], props: {...(plan.transitions[i].props ?? {}), ...obj(op, 'props')}};
      }
      return;
    }
    case 'transition.remove':
      plan.transitions.splice(findIndex(plan.transitions, str(op, 'id'), 'transition'), 1);
      return;
    case 'sfx.add':
      plan.sfx.push(obj<Sfx>(op, 'sfx'));
      return;
    case 'sfx.update':
      update(plan.sfx, str(op, 'id'), 'sfx', obj(op, 'set'));
      return;
    case 'sfx.remove':
      plan.sfx.splice(findIndex(plan.sfx, str(op, 'id'), 'sfx'), 1);
      return;
    case 'camera.set': {
      // {mode, center?, why?} for the whole plan, or {shot, mode} for one shot (mode null clears the shot's own)
      const mode = op.mode as CameraMode | null;
      if (typeof op.shot === 'string') {
        const sh = plan.shots[findIndex(plan.shots, op.shot, 'shot')];
        if (mode === null) delete sh.camera;
        else sh.camera = mode;
      } else {
        plan.camera = {mode: mode ?? 'track', ...(Array.isArray(op.center) ? {center: op.center as [number, number]} : {}),
          ...(typeof op.why === 'string' ? {why: op.why} : {})};
      }
      return;
    }
    case 'audio.set':
      plan.audio = {...plan.audio, ...obj(op, 'set')};
      return;
    // ---------- tokens, components, inputs, notes ----------
    case 'tokens.set':
    case 'tokens.reset': {
      const parts = str(op, 'path').split('.');
      let cur = plan.tokens as Record<string, unknown>;
      for (const p of parts.slice(0, -1)) {
        if (typeof cur[p] !== 'object' || cur[p] === null) {
          if (op.op === 'tokens.reset') return;
          cur[p] = {};
        }
        cur = cur[p] as Record<string, unknown>;
      }
      const last = parts[parts.length - 1];
      if (op.op === 'tokens.set') cur[last] = clone(op.value);
      else delete cur[last];
      return;
    }
    case 'component.upgrade': {
      const from = str(op, 'from');
      const to = str(op, 'to');
      if (from.split('@')[0] !== to.split('@')[0]) throw new Error('upgrade keeps the component name, only the version changes');
      let n = 0;
      const swap = (ref: string) => (ref === from ? (n++, to) : ref);
      plan.captions.component = swap(plan.captions.component);
      plan.captions.lines = plan.captions.lines.map((l) => (l.component ? {...l, component: swap(l.component)} : l));
      plan.shots = plan.shots.map((s) => (s.captions ? {...s, captions: {...s.captions, component: swap(s.captions.component)}} : s));
      plan.overlays = plan.overlays.map((o) => ({...o, component: swap(o.component)}));
      plan.transitions = plan.transitions.map((x) => ({...x, component: swap(x.component)}));
      if (n === 0) throw new Error(`the plan doesn't use ${from}`);
      return;
    }
    case 'input.set': {
      const key = str(op, 'key') as keyof EditPlan['inputs'];
      if (key === 'broll') throw new Error('b-roll assets come with their shots');
      (plan.inputs as Record<string, unknown>)[key] = str(op, 'asset');
      return;
    }
    case 'reference.set':
      plan.reference = {asset: str(op, 'asset'), study: str(op, 'study')};
      return;
    case 'note.add': {
      const notes = notesOf(plan);
      const n = Math.max(0, ...notes.map((x) => Number(/^n(\d+)$/.exec(x.id)?.[1] ?? 0))) + 1;
      if (op.at !== undefined) parseAnchor(str(op, 'at'));
      if (op.to !== undefined) parseAnchor(str(op, 'to'));
      plan.notes = [...notes, {id: `n${n}`, text: str(op, 'text'), status: 'open', by: byKind,
        ...(op.at !== undefined ? {at: str(op, 'at')} : {}), ...(op.to !== undefined ? {to: str(op, 'to')} : {})}];
      return;
    }
    case 'note.resolve':
    case 'note.reopen': {
      const notes = notesOf(plan);
      const i = findIndex(notes, str(op, 'id'), 'note');
      notes[i] = op.op === 'note.resolve'
        ? {...notes[i], status: 'done', ...(op.reply !== undefined ? {reply: str(op, 'reply')} : {})}
        : {...notes[i], status: 'open'};
      plan.notes = notes;
      return;
    }
    case 'plan.import': {
      if (byKind !== 'system') throw new Error('only the system can import a whole plan');
      const doc = obj<EditPlan>(op, 'plan');
      Object.keys(plan).forEach((k) => delete (plan as Record<string, unknown>)[k]);
      Object.assign(plan, clone(doc));
      return;
    }
    case 'transcript.rebase':
      throw new Error('transcript.rebase is not built yet (phase 0)');
    default:
      throw new Error(`unknown operation "${op.op}"`);
  }
};

/** The plan's notes with ids; a plain string (a note from before ids) reads as a done note n1, n2, … by position. */
export const notesOf = (plan: EditPlan): Note[] =>
  plan.notes.map((x, i) => (typeof x === 'string' ? {id: `n${i + 1}`, text: x, status: 'done'} : x));

/** Apply a batch and validate the result. Throws OpError on a bad op; returns errors from validation as an exception too. */
export const applyBatch = (plan: EditPlan, batch: Batch, ctx: ApplyContext): ApplyResult => {
  if (batch.base > plan.version) throw new Error(`batch base ${batch.base} is newer than the plan (v${plan.version})`);
  const next = clone(plan);
  batch.ops.forEach((op, i) => {
    try {
      applyOp(next, op, ctx, batch.by.kind);
    } catch (e) {
      throw new OpError(i, op, (e as Error).message);
    }
  });
  next.version = plan.version + 1;
  const report = validatePlan({...ctx, plan: next});
  if (!report.ok) {
    const msg = report.errors.slice(0, 8).map((e) => `[${e.rule}] ${e.message}`).join('\n');
    throw new Error(`the batch leaves the plan invalid:\n${msg}`);
  }
  // lessons: only breaches this batch adds count (a lesson learned today doesn't block work on an older plan)
  if (ctx.lessons?.length && report.resolved) {
    let before = new Set<string>();
    try {
      before = new Set(breaches(ctx.lessons, plan, resolvePlan({...ctx, plan})).map((b) => b.key));
    } catch {} // the old plan doesn't resolve (an import, a scaffold): everything counts as new
    const fresh = breaches(ctx.lessons, next, report.resolved).filter((b) => !before.has(b.key));
    if (fresh.length) throw new LessonError(fresh);
  }
  return {plan: next, warnings: report.warnings, rebased: batch.base !== plan.version};
};
