// Plan version 1 for a new project: the style, the analysis inputs, pauses trimmed by the style's rules, one shot,
// and one caption line per kept word. Claude's edit is then batches of operations on top of it. Node only.
import fs from 'node:fs';
import path from 'node:path';
import {applyBatch} from './ops';
import {trimPauses} from './trim';
import type {EditPlan, JobManifest, Style, Transcript} from './types';
import {HOME, assetResolver, loadComponents, loadStyle, readJson, writeJson} from './store';

const ref = (manifest: JobManifest, id: string) => {
  const a = manifest.assets[id];
  if (!a) throw new Error(`job.json has no ${id} asset: run the analysis first`);
  return a.version ? `asset:${id}@${a.version}` : `asset:${id}`;
};

export const scaffold = (dir: string, styleRef: string, home = HOME) => {
  const manifest = readJson<JobManifest>(path.join(dir, 'job.json'));
  const style: Style = loadStyle(styleRef, home);
  const transcript = readJson<Transcript>(path.join(dir, 'analysis/transcript.json'));
  const words = transcript.words;
  if (!words.length) throw new Error('the transcript has no words');
  const from = Math.max(0, words[0].start - 0.15); // a little air before the first word
  const segments = trimPauses(words, {from, rules: style.rules.timeline, natural: true});
  const kept = words.filter((w) => segments.some((g) => w.start >= g.in && w.start < g.out));
  const components = style.components as Record<string, {component: string; props?: Record<string, unknown>}>;
  const doc: EditPlan = {
    schema: 'motionable.edit-plan/1',
    job: manifest.id,
    version: 0,
    style: styleRef,
    reference: null,
    canvas: style.canvas,
    language: 'uz-Latn',
    inputs: {source: 'asset:src_main', ...(manifest.assets.proxy ? {proxy: 'asset:proxy'} : {}),
      ...(manifest.assets.trk_main ? {track: ref(manifest, 'trk_main')} : {})},
    transcript: {asset: ref(manifest, 'tr_main'), edits: {}},
    timeline: {segments, removed: [], suggested: [], why: `style ${styleRef}: pauses over ${style.rules.timeline.trimPausesOver} s trimmed, natural pauses kept`},
    tokens: {},
    shots: [{id: 's1', from: 'cut:0', kind: 'speaker', level: style.rules.framing.levels[0], why: 'scaffold: one shot until the director cuts'}],
    captions: {component: components.captions.component, props: components.captions.props ?? {}, lines: kept.map((w) => ({id: `w${w.i}`, words: [w.i], role: 'cap'}))},
    overlays: [],
    transitions: [],
    sfx: [],
    audio: {loudness: style.rules.sound?.loudness ?? -14},
    notes: [],
    camera: manifest.assets.trk_main ? {mode: 'track'} : {mode: 'fixed', why: 'no face track for this video'},
  };
  const ctx = {style, transcript, track: doc.inputs.track ? readJson(path.join(dir, assetResolver(dir, manifest)(doc.inputs.track).path)) as never : null,
    components: loadComponents(styleRef, home), asset: assetResolver(dir, manifest)};
  const batch = {base: 0, by: {kind: 'system' as const, tool: 'scaffold'}, why: 'scaffold from the style and the analysis', ops: [{op: 'plan.import', plan: doc}]};
  const result = applyBatch({...doc}, batch, ctx);
  // an existing plan (its history, drafts and reviews) is archived, never deleted
  const planDir = path.join(dir, 'plan');
  if (fs.existsSync(path.join(planDir, 'history.jsonl'))) {
    const to = path.join(dir, 'plan.archive', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(to, {recursive: true});
    fs.renameSync(planDir, path.join(to, 'plan'));
    // renders are named by plan version, so the old ones go with their plan
    if (fs.existsSync(path.join(dir, 'render'))) fs.renameSync(path.join(dir, 'render'), path.join(to, 'render'));
  } else fs.rmSync(planDir, {recursive: true, force: true});
  writeJson(path.join(dir, 'plan', 'edit-plan.json'), result.plan);
  writeJson(path.join(dir, 'plan', 'versions', `v${result.plan.version}.json`), result.plan);
  fs.writeFileSync(path.join(dir, 'plan', 'history.jsonl'),
    JSON.stringify({version: 1, at: new Date().toISOString(), base: 0, by: batch.by, why: batch.why, ops: batch.ops,
      warnings: result.warnings.map((w) => `[${w.rule}] ${w.message}`)}) + '\n');
  return {plan: result.plan};
};
