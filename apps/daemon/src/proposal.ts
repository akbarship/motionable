// Claude's proposal: before any edit, what the user will get, scene by scene and why. It lives in
// plan/proposal.json (never in the edit plan), every version kept; the user approves one or asks for changes.
import fs from 'node:fs';
import path from 'node:path';
import type {JobManifest} from '@motionable/plan';
import {readJson, writeJson} from '@motionable/plan/store';

export type Scene = {from: number; to: number; title: string; what: string; why: string};
export type ProposalInput = {
  summary: string; style?: string;
  scenes: Scene[];
  cuts?: {from: number; to: number; why: string}[]; // source seconds
  audio?: string; delivery?: string;
  /** keep: the voice's own pauses stay (a paced voiceover); trim (default): the style's pause trimming */
  pauses?: 'trim' | 'keep';
  /** clips the user should upload (no stock key, or nothing fitting): what, and where in the video */
  needs?: {what: string; when?: string}[];
};
export type Proposal = ProposalInput & {
  v: number; at: string; durationS: number; cutS: number;
  status: 'proposed' | 'approved' | 'revise'; feedback?: string; decidedAt?: string;
};
type Doc = {versions: Proposal[]};

const file = (dir: string) => path.join(dir, 'plan', 'proposal.json');
const read = (dir: string): Doc => (fs.existsSync(file(dir)) ? readJson<Doc>(file(dir)) : {versions: []});
const r2 = (n: number) => Math.round(n * 100) / 100;

export const proposals = (dir: string) => read(dir).versions;
export const currentProposal = (dir: string) => read(dir).versions.at(-1) ?? null;

/** Check a proposal against the source and keep it as the next version. Scenes are in output seconds. */
export const saveProposal = (dir: string, p: ProposalInput) => {
  const m = readJson<JobManifest>(path.join(dir, 'job.json'));
  const src = Number((m.assets.src_main?.meta as {duration?: number} | undefined)?.duration ?? NaN);
  if (!Number.isFinite(src)) throw new Error('the analysis is not finished: no source yet');
  if (typeof p.summary !== 'string' || !p.summary.trim()) throw new Error('summary is required');
  if (!Array.isArray(p.scenes) || !p.scenes.length) throw new Error('at least one scene');
  const span = (x: {from: number; to: number}, max: number, what: string) => {
    if (!(Number.isFinite(x.from) && Number.isFinite(x.to) && x.from >= 0 && x.to > x.from)) throw new Error(`${what}: from must be before to`);
    if (x.to > max + 0.05) throw new Error(`${what}: ends at ${x.to}s, past the ${r2(max)}s it can be`);
  };
  const cuts = [...(p.cuts ?? [])].sort((a, b) => a.from - b.from);
  cuts.forEach((c, i) => {
    span(c, src, `cut ${i + 1}`);
    if (i && c.from < cuts[i - 1].to) throw new Error(`cut ${i + 1} overlaps cut ${i}`);
    if (!c.why?.trim()) throw new Error(`cut ${i + 1}: why is required`);
  });
  const cutS = r2(cuts.reduce((a, c) => a + c.to - c.from, 0));
  const durationS = r2(src - cutS);
  p.scenes.forEach((s, i) => {
    span(s, durationS, `scene ${i + 1}`);
    if (i && s.from < p.scenes[i - 1].to - 0.05) throw new Error(`scene ${i + 1} starts before scene ${i} ends`);
    for (const k of ['title', 'what', 'why'] as const) if (typeof s[k] !== 'string' || !s[k].trim()) throw new Error(`scene ${i + 1}: ${k} is required`);
  });
  const doc = read(dir);
  const next: Proposal = {
    v: (doc.versions.at(-1)?.v ?? 0) + 1, at: new Date().toISOString(), status: 'proposed', durationS, cutS,
    summary: p.summary.trim(), ...(p.style ? {style: p.style} : m.brief?.style ? {style: m.brief.style} : {}),
    scenes: p.scenes.map(({from, to, title, what, why}) => ({from: r2(from), to: r2(to), title: title.trim(), what: what.trim(), why: why.trim()})),
    cuts: cuts.map(({from, to, why}) => ({from: r2(from), to: r2(to), why: why.trim()})),
    ...(p.audio?.trim() ? {audio: p.audio.trim()} : {}), ...(p.delivery?.trim() ? {delivery: p.delivery.trim()} : {}),
    ...(p.pauses === 'keep' ? {pauses: 'keep' as const} : {}),
    ...(p.needs?.length ? {needs: p.needs.filter((x) => x?.what?.trim()).map((x) => ({what: x.what.trim(), ...(x.when?.trim() ? {when: x.when.trim()} : {})}))} : {}),
  };
  writeJson(file(dir), {versions: [...doc.versions, next]});
  return next;
};

/** The user's answer from the Studio on the current version: approved, or changes asked for in their words. */
export const decide = (dir: string, status: 'approved' | 'revise', feedback?: string) => {
  const doc = read(dir);
  const cur = doc.versions.at(-1);
  if (!cur) throw new Error('no proposal yet');
  cur.status = status;
  cur.decidedAt = new Date().toISOString();
  if (feedback?.trim()) cur.feedback = feedback.trim();
  writeJson(file(dir), doc);
  return cur;
};
