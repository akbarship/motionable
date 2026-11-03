// Projects on disk and their compact state for Claude (rule: diffs, not full plans).
import fs from 'node:fs';
import path from 'node:path';
import {buildTimeline, lessonsFor, notesOf, parseAnchor, proposeCuts, resolveAnchor, resolvePlan, wordsOf, type Batch, type EditPlan, type JobManifest, type Range, type Word} from '@motionable/plan';
import type {Job} from '@motionable/plan/store';
import {currentProposal} from './proposal';
import {HOME, commitBatch, loadJob, loadLessons, readJson, undo} from '@motionable/plan/store';

export const projectsDir = (home = HOME) => path.join(home, 'projects');
export const projectDir = (id: string, home = HOME) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`bad project id "${id}"`);
  return path.join(projectsDir(home), id);
};

const planFile = (dir: string) => path.join(dir, 'plan', 'edit-plan.json');

export const listProjects = (home = HOME) => {
  const root = projectsDir(home);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((id) => fs.existsSync(path.join(root, id, 'job.json'))).map((id) => {
    const dir = path.join(root, id);
    const plan = fs.existsSync(planFile(dir)) ? readJson<EditPlan>(planFile(dir)) : null;
    const m = readJson<JobManifest & {title?: string; createdAt?: string}>(path.join(dir, 'job.json'));
    const version = plan?.version ?? 0;
    const exported = version > 0 && fs.existsSync(path.join(dir, 'out')) && fs.readdirSync(path.join(dir, 'out')).some((f) => f.startsWith(`${id}-v`) && f.endsWith('.mp4'));
    // where the video is, in the user's words: being prepared, its plan waiting for an OK, being edited, exported
    const stage = version > 0 ? (exported ? 'exported' : 'editing') : currentProposal(dir)?.status === 'proposed' ? 'proposal' : 'setup';
    return {id, title: m.title || id, at: m.createdAt ?? null, style: plan?.style ?? null, version, stage};
  }).sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
};

type HistoryEntry = {version: number; by: Batch['by']; why?: string; ops: Batch['ops']; warnings?: string[]};

const opLabel = (o: Batch['ops'][number]) => {
  // ops that add a whole object (overlay.add {overlay}, shot.insert {shot}, …) are labelled by that object's id
  const named = (v: unknown) => (v && typeof v === 'object' ? (v as {id?: unknown}).id : v);
  const id = o.id ?? o.line ?? named(o.shot) ?? named(o.overlay) ?? named(o.transition) ?? o.word;
  return id === undefined ? o.op : `${o.op}:${String(id)}`;
};

/** Plan versions after `since`, one short line each. */
export const changesSince = (dir: string, since: number) => {
  const file = path.join(dir, 'plan', 'history.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as HistoryEntry)
    .filter((e) => e.version > since)
    .map((e) => ({v: e.version, by: e.by.kind, why: e.why, ops: e.ops.slice(0, 12).map(opLabel).concat(e.ops.length > 12 ? [`+${e.ops.length - 12} more`] : [])}));
};

const analysisSummary = (dir: string) => {
  const file = path.join(dir, 'analysis', 'report.json');
  if (!fs.existsSync(file)) return {steps: {}, warnings: []};
  const r = readJson<{steps: Record<string, {status: string; error?: string}>; warnings: string[]}>(file);
  return {
    steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v.error ? `${v.status}: ${v.error.slice(0, 160)}` : v.status])),
    warnings: r.warnings,
  };
};

/** What the project needs next, in one line, so Claude doesn't have to work it out. */
const nextStep = (dir: string, analysis: ReturnType<typeof analysisSummary>, busy: boolean) => {
  const st = analysis.steps as Record<string, string>;
  if (busy || Object.values(st).some((v) => v === 'running')) return 'analysis is running; check again shortly';
  if (st.sheet !== 'done') return 'analysis not finished (POST analyze)';
  if (!fs.existsSync(path.join(dir, 'analysis', 'transcript.json'))) return 'transcribe (paid, the user\'s ElevenLabs key): ask the user first';
  if (!fs.existsSync(planFile(dir))) {
    const p = currentProposal(dir);
    if (!p || p.status === 'revise') return p ? `revise the proposal: ${p.feedback ?? ''}`.trim() : 'write the proposal with propose_plan; the user approves it in the Studio';
    if (p.status === 'proposed') return 'the user is reading the proposal: wait_for_studio';
    return `approved: scaffold_plan {style: ${p.style ?? 'the brief\'s style'}}, then build it scene by scene`;
  }
  return 'edit with apply_ops';
};

/** Notes with their moment in the output, in seconds (anchors follow the words through cuts). */
const timedNotes = (job: Job) => {
  const {plan} = job;
  const fps = plan.canvas.fps;
  const map = buildTimeline(plan.timeline.segments, fps);
  const words = wordsOf(plan, job.ctx.transcript);
  const t = (a?: string) => {
    if (!a) return undefined;
    try {
      return +(resolveAnchor(a, {map, words, anchorLead: 0}) / fps).toFixed(2);
    } catch {
      return undefined;
    }
  };
  return notesOf(plan).map((n) => ({...n, t: t(n.at), tEnd: t(n.to)}));
};

/** The user's uploaded files in one short line each, so Claude knows what it can use (asset:<id>). */
const projectFiles = (dir: string) => {
  const m = readJson<{assets: Record<string, {kind: string; meta?: Record<string, unknown>}>}>(path.join(dir, 'job.json'));
  const files = Object.entries(m.assets).filter(([k]) => /^(br|img|aud|file)_/.test(k))
    .map(([k, a]) => `${k} ${a.kind}${typeof a.meta?.duration === 'number' ? ` ${a.meta.duration.toFixed(1)}s` : ''}`);
  return files.length ? files : undefined;
};

/** The wizard's brief: Claude asks for it once (the MCP shim remembers), never again in the diffs after it. */
const briefOf = (dir: string) => readJson<JobManifest>(path.join(dir, 'job.json')).brief;

/** A compact summary: counts and the timeline length, never the whole plan. */
export const projectState = (id: string, since = 0, busy = false, home = HOME, withBrief = false) => {
  const dir = projectDir(id, home);
  const analysis = analysisSummary(dir);
  const brief = withBrief ? briefOf(dir) : undefined;
  if (!fs.existsSync(planFile(dir))) {
    // the source's length (once prepared): the Studio prices the paid transcript in minutes of audio from it
    const m = readJson<JobManifest>(path.join(dir, 'job.json'));
    const src = (m.assets.src_main?.meta as {duration?: number} | undefined)?.duration;
    // the lessons Claude keeps in mind while it proposes (the brief names the style)
    const lessons = m.brief?.style ? lessonsFor(loadLessons(), m.brief.style).filter((x) => !x.rule).slice(-10).map((x) => x.text) : [];
    return {id, version: 0, style: null, ...(src ? {durationS: +src.toFixed(2)} : {}), ...(brief ? {brief} : {}), analysis,
      next: nextStep(dir, analysis, busy), files: projectFiles(dir), ...(lessons.length ? {lessons} : {})};
  }
  const plan = readJson<EditPlan>(planFile(dir));
  const fps = plan.canvas.fps;
  const frames = plan.timeline.segments.reduce((n, g) => n + Math.round((g.out - g.in) * fps), 0);
  return {
    id, version: plan.version, style: plan.style, durationS: +(frames / fps).toFixed(2), ...(brief ? {brief} : {}),
    counts: {segments: plan.timeline.segments.length, removed: plan.timeline.removed.length, suggested: plan.timeline.suggested.length,
      shots: plan.shots.length, lines: plan.captions.lines.length, overlays: plan.overlays.length, transitions: plan.transitions.length, sfx: plan.sfx.length},
    camera: plan.camera?.mode ?? (plan.inputs.track ? 'track' : 'fixed'),
    analysis: analysis.warnings.length ? {warnings: analysis.warnings} : undefined,
    changes: changesSince(dir, since),
    files: projectFiles(dir),
    // the user's lessons that no rule can check: keep them in mind (the ones with rules are enforced on apply_ops)
    lessons: (() => {
      const l = lessonsFor(loadLessons(), plan.style).filter((x) => !x.rule).slice(-10).map((x) => x.text);
      return l.length ? l : undefined;
    })(),
    // the user's open notes come first: do them, then close each with note.resolve {id, reply}
    notes: plan.notes.some((n) => typeof n !== 'string' && n.status === 'open')
      ? timedNotes(loadJob(dir, home)).filter((n) => n.status === 'open').map(({id, t, tEnd, at, text}) => ({id, t, tEnd, at, text}))
      : undefined,
  };
};

export const applyOps = (id: string, batch: Batch, home = HOME) => {
  const job = loadJob(projectDir(id, home), home);
  const r = commitBatch(job, batch);
  return {version: r.plan.version, warnings: r.warnings.map((w) => `[${w.rule}] ${w.message}`), rebased: r.rebased};
};

/** Cut candidates on the words still kept, already-suggested ranges left out. Text is shortened (tokens). */
export const cutCandidates = (id: string, home = HOME) => {
  const job = loadJob(projectDir(id, home), home);
  const {plan} = job;
  const map = buildTimeline(plan.timeline.segments, plan.canvas.fps);
  const known = new Set([...plan.timeline.suggested, ...plan.timeline.removed].map((r) => `${r.from}|${r.to}`));
  const all = proposeCuts(wordsOf(plan, job.ctx.transcript), map.isKept).filter((c) => !known.has(`${c.from}|${c.to}`));
  return {
    base: plan.version,
    candidates: all.map((c) => ({kind: c.kind, from: c.from, to: c.to, sure: c.sure,
      text: c.text.length > 60 ? `${c.text.slice(0, 57)}…` : c.text, evidence: c.evidence})),
  };
};

export const undoLast = (id: string, home = HOME) => {
  const r = undo(loadJob(projectDir(id, home), home));
  return {version: r.plan.version, restored: r.restored};
};

/** A range's first and last word index (word anchors, or times snapped to the words they cover). */
const rangeWords = (r: Range, words: Word[]) => {
  const at = (a: string, end: boolean) => {
    const p = parseAnchor(a);
    if (p.base === 'word') return p.n;
    if (p.base === 't') {
      const t = p.s;
      const i = end ? words.filter((w) => w.end <= t + 0.01).length - 1 : words.findIndex((w) => w.start >= t - 0.01);
      return i < 0 ? null : i;
    }
    return null;
  };
  const from = at(r.from, false), to = at(r.to, true);
  return from === null || to === null ? null : {from, to};
};

/** Everything the Studio draws, in output seconds: words with their kept state, ranges, caption lines and lanes. */
export const studioView = (id: string, home = HOME) => {
  const job = loadJob(projectDir(id, home), home);
  const {plan} = job;
  const fps = plan.canvas.fps;
  const r = resolvePlan({plan, ...job.ctx});
  const map = buildTimeline(plan.timeline.segments, fps);
  const words = wordsOf(plan, job.ctx.transcript);
  const s = (f: number) => +(f / fps).toFixed(3);
  const lineOf = new Map<number, string>();
  for (const l of plan.captions.lines) for (const i of l.words) lineOf.set(i, l.id);
  const ranges = (list: Range[]) => list.map((x, k) => ({k, ...rangeWords(x, words), kind: x.kind, why: x.why, evidence: x.evidence, anchors: [x.from, x.to]}));
  return {
    id, version: plan.version, style: plan.style, fps, durationS: s(r.totalFrames), canvas: plan.canvas,
    words: words.map((w) => {
      const kept = map.isKept(w.start);
      // at: where the anchor word:i lands (the start less the style's anchor lead), so a drag can write word:i+Nf exactly
      const at = kept ? s(resolveAnchor(`word:${w.i}`, {map, words, anchorLead: r.tokens.timing.anchorLead})) : null;
      return {i: w.i, text: w.text, start: w.start, end: w.end, conf: w.conf ?? null, kept, out: kept ? s(map.srcToFrame(w.start)) : null, at,
        line: lineOf.get(w.i) ?? null};
    }),
    removed: ranges(plan.timeline.removed),
    suggested: ranges(plan.timeline.suggested),
    captions: {component: plan.captions.component, props: plan.captions.props ?? {}},
    lines: plan.captions.lines.map((l) => ({id: l.id, words: l.words, role: l.role, hidden: !!l.hidden, component: l.component ?? null, props: l.props ?? null})),
    lanes: {
      shots: r.shots.map((x) => ({id: x.id, kind: x.kind, level: plan.shots.find((p) => p.id === x.id)?.level ?? null, start: s(x.start), end: s(x.end)})),
      overlays: r.overlays.map((x) => ({id: x.id, component: x.component, start: s(x.start), end: s(x.end)})),
      transitions: r.transitions.map((x) => ({id: x.id, component: x.component, start: s(x.cut - x.before), end: s(x.cut + x.after)})),
    },
    roles: Object.keys(job.ctx.style.tokens.type ?? {}),
    notes: timedNotes(job),
  };
};

/** The captions as SRT, one cue per visible line: from its first kept word to the next line (at most 0.8 s after its
 * last word). Times are the edit's output, as the Studio shows them. */
export const srtOf = (id: string, home = HOME) => {
  const v = studioView(id, home);
  const cues = v.lines.filter((l) => !l.hidden).map((l) => {
    const ws = l.words.map((i) => v.words[i]).filter((w) => w && w.out !== null);
    if (!ws.length) return null;
    const last = ws[ws.length - 1];
    return {start: ws[0].out!, end: last.out! + (last.end - last.start), text: ws.map((w) => w.text).join(' ')};
  }).filter((c): c is {start: number; end: number; text: string} => c !== null).sort((a, b) => a.start - b.start);
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => {
    const end = Math.min(i + 1 < cues.length ? cues[i + 1].start : v.durationS, c.end + 0.8, v.durationS);
    return `${i + 1}\n${ts(c.start)} --> ${ts(Math.max(end, c.start + 0.1))}\n${c.text}\n`;
  }).join('\n');
};
