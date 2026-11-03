// Storage: projects, styles and their components are folders in the user's data home (default ~/Motionable,
// override with MOTIONABLE_HOME). A style's components live in styles/<name>/<v>/components/<c>/<v>/. Node only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {Batch, ComponentManifest, EditPlan, JobManifest, Style, Track, Transcript} from './types';
import type {AssetInfo} from './resolve';
import {validateComponentManifest, validateStyleDoc, type Issue} from './validate';
import {applyBatch, LessonError, type ApplyContext} from './ops';
import {lessonsFor, type Lesson} from './lessons';

export const HOME = process.env.MOTIONABLE_HOME ?? path.join(os.homedir(), 'Motionable');
/** The app's own state (keys, lessons): ~/.motionable, or MOTIONABLE_STATE. */
export const STATE = process.env.MOTIONABLE_STATE ?? path.join(os.homedir(), '.motionable');
export const styleDir = (ref: string, home = HOME) => {
  const [name, version] = ref.split('@');
  return path.join(home, 'styles', name, version);
};

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), {recursive: true});
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};

/** Every usable component of a style (drafts left out), keyed by name@version. */
export const loadComponents = (styleRef: string, home = HOME) => {
  const out: Record<string, ComponentManifest> = {};
  const problems: string[] = [];
  const dir = path.join(styleDir(styleRef, home), 'components');
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!fs.statSync(path.join(dir, name)).isDirectory()) continue; // e.g. requests.jsonl, the coder's log
    for (const version of fs.readdirSync(path.join(dir, name))) {
      const file = path.join(dir, name, version, 'component.json');
      if (!fs.existsSync(file)) continue;
      const m = readJson<ComponentManifest>(file);
      if (m.status === 'draft') continue; // still in the gate: nobody can use it, and it may not be valid yet
      const issues = validateComponentManifest(m);
      if (`${m.name}` !== name || String(m.version) !== version) issues.push({level: 'error', rule: 'component', message: `folder ${name}/${version} holds ${m.name}@${m.version}`});
      if (issues.length) problems.push(...issues.map((i: Issue) => `${name}@${version}: ${i.message}`));
      else out[`${m.name}@${m.version}`] = m;
    }
  }
  if (problems.length) throw new Error(`invalid components:\n${problems.join('\n')}`);
  return out;
};

export const loadStyle = (ref: string, home = HOME): Style => {
  const t = readJson<Style>(path.join(styleDir(ref, home), 'style.json'));
  const issues = validateStyleDoc(t);
  if (issues.length) throw new Error(`invalid style ${ref}:\n${issues.map((i) => i.message).join('\n')}`);
  return t;
};

export type Job = {
  dir: string;
  manifest: JobManifest;
  plan: EditPlan;
  ctx: ApplyContext;
};

/** Resolve asset:<id>[@version] through the job's job.json. Paths are relative to the job folder. */
export const assetResolver = (dir: string, manifest: JobManifest) => (ref: string): AssetInfo => {
  const m = /^asset:([A-Za-z0-9_.-]+?)(?:@(\d+))?$/.exec(ref);
  if (!m) throw new Error(`bad asset reference "${ref}"`);
  const a = manifest.assets[m[1]];
  if (!a) throw new Error(`asset ${m[1]} isn't in ${path.join(dir, 'job.json')}`);
  if (m[2] && a.version !== undefined && String(a.version) !== m[2]) throw new Error(`asset ${m[1]} is version ${a.version}, the plan pins @${m[2]}`);
  if (!fs.existsSync(path.join(dir, a.path))) throw new Error(`asset ${m[1]}: missing file ${a.path}`);
  return {path: a.path, meta: a.meta};
};

export const loadJob = (dir: string, home = HOME): Job => {
  const manifest = readJson<JobManifest>(path.join(dir, 'job.json'));
  const plan = readJson<EditPlan>(path.join(dir, 'plan', 'edit-plan.json'));
  const asset = assetResolver(dir, manifest);
  const transcript = readJson<Transcript>(path.join(dir, asset(plan.transcript.asset).path));
  const track = plan.inputs.track ? readJson<Track>(path.join(dir, asset(plan.inputs.track).path)) : null;
  return {
    dir,
    manifest,
    plan,
    ctx: {style: loadStyle(plan.style, home), transcript, track, components: loadComponents(plan.style, home), asset,
      lessons: lessonsFor(loadLessons(), plan.style)},
  };
};

/** Every plan version is kept whole in plan/versions/, so an undo restores it exactly. */
const versionFile = (dir: string, v: number) => path.join(dir, 'plan', 'versions', `v${v}.json`);
const keepVersion = (dir: string, plan: EditPlan) => {
  if (!fs.existsSync(versionFile(dir, plan.version))) writeJson(versionFile(dir, plan.version), plan);
};

/** Apply a batch to the job's plan, then save the new version and append the batch to the history. */
export const commitBatch = (job: Job, batch: Batch) => {
  keepVersion(job.dir, job.plan); // plans saved before versions were kept
  let result;
  try {
    result = applyBatch(job.plan, batch, job.ctx);
  } catch (e) {
    if (e instanceof LessonError) countStops(e.breaches.map((b) => b.lesson.id));
    throw e;
  }
  writeJson(path.join(job.dir, 'plan', 'edit-plan.json'), result.plan);
  keepVersion(job.dir, result.plan);
  const entry = {version: result.plan.version, at: new Date().toISOString(), base: batch.base, by: batch.by, why: batch.why, ops: batch.ops,
    warnings: result.warnings.map((w) => `[${w.rule}] ${w.message}`)};
  fs.appendFileSync(path.join(job.dir, 'plan', 'history.jsonl'), JSON.stringify(entry) + '\n');
  job.plan = result.plan;
  return result;
};

/** The version an undo goes back to: the history is a stack where each undo pops the change it took back. */
export const undoTarget = (dir: string): number | null => {
  const file = path.join(dir, 'plan', 'history.jsonl');
  if (!fs.existsSync(file)) return null;
  const stack: number[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const e = JSON.parse(line) as {version: number; by: Batch['by']};
    if (e.by.tool === 'undo') {
      stack.pop();
      stack[stack.length - 1] = e.version; // the undo's version is the restored plan
    } else stack.push(e.version);
  }
  return stack.length > 1 ? stack[stack.length - 2] : null;
};

/** Take back the last change: the plan of the version before it comes back as a new version (history stays). */
export const undo = (job: Job) => {
  const target = undoTarget(job.dir);
  if (target === null) throw new Error('nothing to undo');
  if (!fs.existsSync(versionFile(job.dir, target))) throw new Error(`plan v${target} wasn't kept, it can't be restored`);
  const {version: _, ...plan} = readJson<EditPlan>(versionFile(job.dir, target));
  return {restored: target, ...commitBatch(job, {base: job.plan.version, by: {kind: 'system', tool: 'undo'}, why: `undo: back to v${target}`,
    ops: [{op: 'plan.import', plan: {...plan, version: job.plan.version}}]})};
};

// ---------- lessons: one JSON file each in <state>/lessons ----------
const lessonsDir = (state = STATE) => path.join(state, 'lessons');
const LESSON_ID = /^[a-z0-9-]{3,60}$/;

export const loadLessons = (state = STATE): Lesson[] => {
  const dir = lessonsDir(state);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson<Lesson>(path.join(dir, f)))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
};

/** Save a lesson; a new one gets an id from its text. */
export const saveLesson = (l: Omit<Lesson, 'id' | 'at'> & {id?: string; at?: string}, state = STATE): Lesson => {
  if (!l.text?.trim()) throw new Error('a lesson needs the user\'s words (text)');
  if (l.scope !== 'global' && !/^style:[a-z0-9-]+$/.test(l.scope)) throw new Error(`scope must be "global" or "style:<name>", not "${l.scope}"`);
  const base = l.id ?? (l.text.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'lesson');
  if (!LESSON_ID.test(base)) throw new Error(`bad lesson id "${base}"`);
  let id = base;
  for (let n = 2; !l.id && fs.existsSync(path.join(lessonsDir(state), `${id}.json`)); n++) id = `${base}-${n}`;
  const lesson: Lesson = {seen: 0, ...l, id, text: l.text.trim(), at: l.at ?? new Date().toISOString()};
  writeJson(path.join(lessonsDir(state), `${id}.json`), lesson);
  return lesson;
};

export const deleteLesson = (id: string, state = STATE) => {
  if (!LESSON_ID.test(id)) throw new Error(`bad lesson id "${id}"`);
  const f = path.join(lessonsDir(state), `${id}.json`);
  if (!fs.existsSync(f)) throw new Error(`no lesson ${id}`);
  fs.rmSync(f);
  return {removed: id};
};

/** A lesson stopped a batch: count it (lessons that keep firing are the ones worth reading). */
const countStops = (ids: string[], state = STATE) => {
  for (const id of new Set(ids)) {
    const f = path.join(lessonsDir(state), `${id}.json`);
    if (!fs.existsSync(f)) continue;
    const l = readJson<Lesson>(f);
    writeJson(f, {...l, seen: (l.seen ?? 0) + 1, last: new Date().toISOString()});
  }
};

export {readJson, writeJson};
