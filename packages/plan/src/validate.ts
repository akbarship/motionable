// Validation (edit-plan.md §10): hard rules reject a plan; soft rules (from the style) return warnings that the
// director or QA must answer.
import Ajv from 'ajv';
import planSchema from '../schema/edit-plan.schema.json';
import componentSchema from '../schema/component.schema.json';
import styleSchema from '../schema/style.schema.json';
import type {ComponentManifest, EditPlan, PropSpec, Style} from './types';
import type {ResolvedPlan} from './resolved';
import {buildTimeline, parseAnchor} from './timeline';
import {checkProps} from './props';
import {fontIssue} from './fonts';
import {planTokens, resolvePlan, ResolveError, wordsOf, type ResolveInput} from './resolve';

export type Issue = {level: 'error' | 'warning'; rule: string; message: string};
export type Report = {ok: boolean; errors: Issue[]; warnings: Issue[]; resolved?: ResolvedPlan};

const ajv = new Ajv({allErrors: true, strict: false});
ajv.addSchema(planSchema); // the style schema refers to its token definitions
const checkPlanSchema = ajv.getSchema('urn:motionable:edit-plan:1')!;
const checkComponentSchema = ajv.compile(componentSchema);
const checkStyleSchema = ajv.compile(styleSchema);

const schemaIssues = (errors: typeof checkPlanSchema.errors): Issue[] =>
  (errors ?? []).map((e) => ({level: 'error', rule: 'schema', message: `${e.instancePath || '/'} ${e.message}`}));

export const validateComponentManifest = (m: unknown): Issue[] =>
  checkComponentSchema(m) ? [] : schemaIssues(checkComponentSchema.errors);

export const validateStyleDoc = (t: unknown): Issue[] =>
  checkStyleSchema(t) ? [] : schemaIssues(checkStyleSchema.errors);

const USABLE = new Set(['private', 'public', 'deprecated']);

export const validatePlan = (input: ResolveInput & {owner?: string | null}): Report => {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (rule: string, message: string) => errors.push({level: 'error', rule, message});
  const warn = (rule: string, message: string) => warnings.push({level: 'warning', rule, message});
  const {plan, style, components} = input;

  if (!checkPlanSchema(plan)) {
    const issues = schemaIssues(checkPlanSchema.errors);
    return {ok: false, errors: issues, warnings};
  }
  if (`${style.name}@${style.version}` !== plan.style) err('style', `plan pins ${plan.style}, got ${style.name}@${style.version}`);

  // ---------- words and timeline ----------
  const words = wordsOf(plan, input.transcript);
  words.forEach((w, i) => w.i !== i && err('transcript', `word at index ${i} has id ${w.i}`));
  for (const k of Object.keys(plan.transcript.edits)) if (!words[Number(k)]) err('transcript', `edit for missing word ${k}`);

  const segs = plan.timeline.segments;
  segs.forEach((g, i) => {
    if (g.out <= g.in) err('timeline', `segment ${g.id} ends before it starts`);
    if (i > 0 && g.in < segs[i - 1].out) err('timeline', `segment ${g.id} overlaps segment ${segs[i - 1].id}`);
  });
  if (new Set(segs.map((g) => g.id)).size !== segs.length) err('timeline', 'segment ids repeat');
  const map = buildTimeline(segs, plan.canvas.fps);

  // ---------- ids ----------
  const unique = (name: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) err('ids', `${name} id "${id}" repeats`);
      seen.add(id);
    }
  };
  unique('shot', plan.shots.map((s) => s.id));
  unique('caption line', plan.captions.lines.map((l) => l.id));
  unique('overlay', plan.overlays.map((o) => o.id));
  unique('transition', plan.transitions.map((x) => x.id));
  unique('sfx', plan.sfx.map((x) => x.id));

  // ---------- anchors in shots may not refer to shots ----------
  for (const s of plan.shots) {
    if (parseAnchor(s.from).base === 'shot') err('shots', `shot ${s.id} starts at a shot anchor`);
  }
  if (plan.shots[0] && plan.shots[0].from !== 'cut:0') err('shots', `the first shot must start at cut:0, not ${plan.shots[0].from}`);

  // ---------- captions cover every kept word exactly once, in order ----------
  const kept = words.filter((w) => map.isKept(w.start)).map((w) => w.i);
  const inLines = plan.captions.lines.flatMap((l) => l.words);
  for (const i of inLines) if (!words[i]) err('captions', `caption word ${i} doesn't exist`);
  for (let k = 1; k < inLines.length; k++) {
    if (inLines[k] <= inLines[k - 1]) err('captions', `caption words out of order at word ${inLines[k]}`);
  }
  const inSet = new Set(inLines);
  for (const i of kept) if (!inSet.has(i)) err('captions', `kept word ${i} ("${words[i].text}") is in no caption line`);
  const keptSet = new Set(kept);
  for (const i of inLines) if (words[i] && !keptSet.has(i)) err('captions', `caption word ${i} ("${words[i].text}") was cut from the timeline`);

  // ---------- tokens, shots, inputs ----------
  const tokens = planTokens(plan, style, input.taste);
  for (const s of plan.shots) {
    if (s.kind === 'speaker' && !(s.level && tokens.framing?.[s.level])) err('shots', `shot ${s.id}: unknown level ${s.level}`);
    if (s.kind === 'broll' && !s.clip) err('shots', `b-roll shot ${s.id} has no clip`);
    if (s.kind === 'motion' && !s.scene) err('shots', `motion shot ${s.id} has no scene`);
    if (s.kind !== 'motion' && s.scene) err('shots', `shot ${s.id} has a scene but isn't a motion shot`);
    if (s.kind === 'speaker' && s.grade && s.grade !== 'base') warn('shots', `shot ${s.id}: per-shot speaker grades aren't rendered yet; "base" is used`);
  }
  for (const l of plan.captions.lines) if (!tokens.type?.[l.role]) err('captions', `line ${l.id}: no text style for role ${l.role}`);
  for (const [role, t] of Object.entries(tokens.type ?? {})) {
    const issue = fontIssue(t.font, t.weight, t.italic);
    if (issue) err('fonts', `text style ${role}: ${issue}`);
  }
  for (const l of plan.captions.lines) {
    if (l.style && (l.style.font || l.style.weight)) {
      const base = tokens.type?.[l.role];
      const issue = base && fontIssue(l.style.font ?? base.font, l.style.weight ?? base.weight, l.style.italic ?? base.italic);
      if (issue) err('fonts', `line ${l.id}: ${issue}`);
    }
  }
  for (const o of plan.overlays) {
    if (o.depth === 'behind-subject' && !plan.inputs.matte) err('overlays', `overlay ${o.id} is behind the subject but the plan has no matte`);
    // retired 2026-10-19: our matte edges aren't good enough for text behind the speaker; old plans still render
    if (o.depth === 'behind-subject') warn('behind-subject', `overlay ${o.id} is drawn behind the speaker: that is retired, draw text in front (above the head or in the free space)`);
  }

  const assets = [plan.inputs.source, plan.inputs.track, plan.transcript.asset, plan.inputs.matte, ...(plan.inputs.broll ?? []),
    ...plan.shots.map((s) => s.clip), ...plan.sfx.map((x) => x.sound)].filter((a): a is string => !!a);
  for (const a of assets) {
    try {
      input.asset(a);
    } catch (e) {
      err('assets', (e as Error).message);
    }
  }

  // ---------- components ----------
  const used: {where: string; ref: string; kind: string; props: Record<string, unknown>}[] = [
    {where: 'captions', ref: plan.captions.component, kind: 'caption', props: plan.captions.props ?? {}},
    ...plan.shots.filter((s) => s.captions).map((s) => ({where: `shot ${s.id}`, ref: s.captions!.component, kind: 'caption', props: s.captions!.props ?? {}})),
    ...plan.captions.lines.filter((l) => l.component).map((l) => ({where: `line ${l.id}`, ref: l.component!, kind: 'caption', props: l.props ?? {}})),
    ...plan.shots.filter((s) => s.scene).map((s) => ({where: `shot ${s.id} scene`, ref: s.scene!.component, kind: 'scene', props: s.scene!.props ?? {}})),
    ...plan.overlays.map((o) => ({where: `overlay ${o.id}`, ref: o.component, kind: 'overlay', props: o.props ?? {}})),
    ...plan.transitions.map((x) => ({where: `transition ${x.id}`, ref: x.component, kind: 'transition', props: x.props ?? {}})),
  ];
  for (const u of used) {
    const m: ComponentManifest | undefined = components[u.ref];
    if (!m) {
      err('components', `${u.where}: unknown component ${u.ref}`);
      continue;
    }
    if (m.kind !== u.kind) err('components', `${u.where}: ${u.ref} is a ${m.kind}, not a ${u.kind}`);
    if (!USABLE.has(m.status)) err('components', `${u.where}: ${u.ref} is ${m.status}`);
    if (m.status === 'private' && m.owner && input.owner !== undefined && m.owner !== input.owner) {
      err('components', `${u.where}: ${u.ref} is private to another account`);
    }
    for (const msg of checkProps(m.props, u.props, tokens)) err('props', `${u.where}: ${msg}`);
  }

  if (errors.length) return {ok: false, errors, warnings};

  // ---------- resolve, then the rules that need frames ----------
  let resolved: ResolvedPlan;
  try {
    resolved = resolvePlan(input);
  } catch (e) {
    if (e instanceof ResolveError || e instanceof Error) err('resolve', e.message);
    return {ok: false, errors, warnings};
  }
  resolved.shots.forEach((s, i) => {
    if (s.end - s.start < 2) err('shots', `shot ${s.id} is shorter than 2 frames`);
    if (i > 0 && s.start <= resolved.shots[i - 1].start) err('shots', `shot ${s.id} doesn't start after ${resolved.shots[i - 1].id}`);
  });
  for (const x of resolved.transitions) if (x.cut === 0) err('transitions', `transition ${x.id} is on the first shot`);

  // a b-roll shot must end before its clip does (past the end the picture freezes or goes black)
  for (const s of plan.shots) {
    if (s.kind !== 'broll' || !s.clip) continue;
    const r = resolved.shots.find((x) => x.id === s.id)!;
    const meta = input.asset(s.clip).meta;
    const dur = Number(meta?.durationS ?? meta?.duration); // uploads store `duration`, like the source
    const need = (s.clipIn ?? 0) + (r.end - r.start) / resolved.canvas.fps;
    if (dur && need > dur) warn('broll-length', `b-roll shot ${s.id} needs ${need.toFixed(1)} s of its clip, which is ${dur.toFixed(1)} s long: move clipIn earlier or shorten the shot`);
  }
  softRules(plan, style, resolved, warn, components);
  for (const b of resolved.captionBlocks) {
    if (b.moved?.onFace) warn('face', `captions ${b.id} cover the face: no room below or above it; use smaller text or a wider framing for shot ${b.shot}`);
  }
  return {ok: errors.length === 0, errors, warnings, resolved};
};

/** The style's limits and the checkable never-dos (styles.md §3.3–3.6). */
const softRules = (plan: EditPlan, style: Style, r: ResolvedPlan, warn: (rule: string, m: string) => void, components: Record<string, ComponentManifest>) => {
  const fps = r.canvas.fps;
  const rules = style.rules;
  // a motion scene should start with something on it: its first anchored item within ~1 s of the cut
  const anchors = (spec: Record<string, PropSpec>, v: Record<string, unknown>): number[] =>
    Object.entries(spec).flatMap(([k, sp]) => {
      const x = v?.[k];
      if (sp.type === 'anchor' && typeof x === 'number') return [x];
      if (sp.type === 'array' && Array.isArray(x) && sp.items?.fields) return x.flatMap((it) => anchors(sp.items!.fields!, it as Record<string, unknown>));
      if (sp.type === 'object' && sp.fields && x) return anchors(sp.fields, x as Record<string, unknown>);
      return [];
    });
  for (const s of r.shots) {
    if (!s.scene) continue;
    const m = components[s.scene.component];
    const at = m ? anchors(m.props, s.scene.props).map((x) => Math.max(0, x)) : [];
    const first = at.length ? Math.min(...at) : 0;
    if (first > 1.2 * fps) warn('scene-empty-start', `motion shot ${s.id} shows an empty frame for ${(first / fps).toFixed(1)} s before its first item: start it later or anchor an item earlier`);
  }
  for (const s of r.shots) {
    const len = (s.end - s.start) / fps;
    if (len > rules.shots.maxS) warn('shot-length', `shot ${s.id} is ${len.toFixed(1)} s (max ${rules.shots.maxS} s)`);
  }
  const motion = r.shots.filter((s) => s.kind === 'motion');
  const mr = rules.motion;
  if (mr?.maxPerVideo !== undefined && motion.length > mr.maxPerVideo) warn('motion', `${motion.length} motion scenes (max ${mr.maxPerVideo})`);
  if (mr?.sceneS) {
    for (const s of motion) {
      const len = (s.end - s.start) / fps;
      if (len < mr.sceneS[0] || len > mr.sceneS[1]) warn('motion', `motion shot ${s.id} is ${len.toFixed(1)} s (aim for ${mr.sceneS[0]}–${mr.sceneS[1]} s)`);
    }
  }
  if (mr?.shareOfRuntime && motion.length) {
    const share = motion.reduce((a, s) => a + s.end - s.start, 0) / r.totalFrames;
    if (share > mr.shareOfRuntime[1]) warn('motion', `motion scenes fill ${(share * 100).toFixed(0)}% of the video (max ${(mr.shareOfRuntime[1] * 100).toFixed(0)}%)`);
  }
  const counts: Record<string, number> = {};
  for (const s of plan.shots) if (s.level) counts[s.level] = (counts[s.level] ?? 0) + 1;
  for (const [level, max] of Object.entries(rules.framing.maxPerVideo ?? {})) {
    if ((counts[level] ?? 0) > max) warn('framing', `level ${level} is used ${counts[level]} times (max ${max})`);
  }

  // hero moments: their start frames, absolute
  const heroes = r.captionBlocks.flatMap((b) => b.lines.filter((l) => l.role === 'hero').map((l) => ({id: l.id, at: b.start + l.words[0].start, block: b})));
  const heroTrigger = style.triggers.find((t) => t.id === 'hero');
  const gap = (heroTrigger?.minGapS ?? 3) * fps;
  for (let i = 1; i < heroes.length; i++) {
    if (heroes[i].at - heroes[i - 1].at < gap) warn('two-heroes', `hero lines ${heroes[i - 1].id} and ${heroes[i].id} are less than ${gap / fps} s apart`);
  }
  // headroom: the top of the head (hair ≈ 35% of the face box above it) shouldn't leave the frame
  for (const s of r.shots) {
    if (s.kind !== 'speaker') continue;
    let cut = 0;
    for (let f = s.start; f < s.end; f++) {
      if (r.faceSeen[f] < 0.5) continue; // no face on screen here
      const [scale, , top] = r.camera[f];
      const [, cy, , fh] = r.face[f];
      const hairTop = ((cy - 0.5 * fh - 0.35 * fh) * r.source.h - top) * scale;
      if (hairTop < 0.015 * r.canvas.h) cut++;
    }
    if (cut / Math.max(1, s.end - s.start) > 0.15) warn('headroom', `shot ${s.id}: the top of the head is cut off in ${Math.round((100 * cut) / (s.end - s.start))}% of its frames (zoom in less, or lower the face target)`);
  }
  const minHold = r.tokens.timing.minHold;
  for (const h of heroes) {
    const cut = r.shots.find((s) => s.start > h.at && s.start - h.at < minHold);
    if (cut) warn('hero-hold', `hero line ${h.id}: the cut to ${cut.id} comes ${((cut.start - h.at) / fps).toFixed(2)} s after it (min ${minHold / fps} s)`);
  }
};
