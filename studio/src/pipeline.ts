// Pure helpers for the pipeline screen: stage status, plan check, quote items, unknown-state detection.
import type { ChatMsg, Task } from './api.js';

export type StageId = 'study' | 'direct' | 'storyboard' | 'execute';
export type StageState = 'idle' | 'queued' | 'running' | 'done' | 'failed';

const STAGE_TYPES: Record<StageId, ReadonlySet<string>> = {
  study: new Set(['study_ref']),
  direct: new Set(['direct']),
  storyboard: new Set(['storyboard', 'storyboard_edit']),
  execute: new Set(['execute', 'edit', 'render', 'generate']),
};

export function stageTasks(tasks: Task[], stage: StageId): Task[] {
  return tasks.filter((t) => STAGE_TYPES[stage].has(t.type));
}

/** Newest by createdAt (ties broken by id). */
export function newestTask(tasks: Task[]): Task | null {
  let best: Task | null = null;
  for (const t of tasks) {
    if (!best || t.createdAt.localeCompare(best.createdAt) > 0 || (t.createdAt === best.createdAt && t.id.localeCompare(best.id) > 0)) {
      best = t;
    }
  }
  return best;
}

export function stageState(tasks: Task[], stage: StageId): StageState {
  const t = newestTask(stageTasks(tasks, stage));
  if (!t) return 'idle';
  if (t.status === 'running') return 'running';
  if (t.status === 'done') return 'done';
  if (t.status === 'failed') return 'failed';
  return 'queued'; // queued or awaiting_approval
}

export const STATE_LABEL: Record<StageState, string> = {
  idle: 'kutilmoqda',
  queued: 'navbatda',
  running: 'ishlanmoqda',
  done: 'tayyor',
  failed: 'xato',
};

/** Last n progress lines across the stage's tasks (oldest task first). */
export function lastProgress(tasks: Task[], stage: StageId, n = 5): string[] {
  const sorted = [...stageTasks(tasks, stage)].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return sorted.flatMap((t) => t.progress).slice(-n);
}

export type AssetSource = 'footage' | 'broll' | 'registry' | 'gen' | 'logo' | 'ui' | 'type';
export interface PlanAsset {
  id: string;
  source: AssetSource;
  what: string;
  kind?: 'image' | 'video';
  seconds?: number;
  prompt?: string;
  refFrames?: string[];
  fallback?: string;
}
export interface PlanScene {
  id: string;
  start: number;
  end: number;
  purpose: string;
  script: string;
  layout: string;
  grammar?: string;
  motion: string;
  assets: PlanAsset[];
  fallback?: string;
}
export interface PlanStory {
  hook: string;
  idea: string;
  payoff: string;
  cta: string;
}
export interface PlanView {
  duration: number;
  story?: PlanStory;
  scenes: PlanScene[];
  genEstimate?: { items: number; usd: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const SOURCES: ReadonlySet<string> = new Set<AssetSource>(['footage', 'broll', 'registry', 'gen', 'logo', 'ui', 'type']);

function readAsset(a: unknown): PlanAsset | null {
  if (!isObj(a) || typeof a.id !== 'string' || typeof a.what !== 'string') return null;
  if (typeof a.source !== 'string' || !SOURCES.has(a.source)) return null;
  if (a.kind !== undefined && a.kind !== 'image' && a.kind !== 'video') return null;
  if (a.source === 'gen' && typeof a.prompt !== 'string') return null;
  const refs = Array.isArray(a.refFrames) ? a.refFrames.filter((x): x is string => typeof x === 'string') : undefined;
  return {
    id: a.id,
    source: a.source as AssetSource,
    what: a.what,
    ...(a.kind ? { kind: a.kind } : {}),
    ...(typeof a.seconds === 'number' ? { seconds: a.seconds } : {}),
    ...(typeof a.prompt === 'string' ? { prompt: a.prompt } : {}),
    ...(refs && refs.length > 0 ? { refFrames: refs } : {}),
    ...(typeof a.fallback === 'string' ? { fallback: a.fallback } : {}),
  };
}

/** Light runtime check of plan.json (the server already validates on read). Null when unusable. */
export function readPlan(raw: unknown): PlanView | null {
  if (!isObj(raw) || !Array.isArray(raw.scenes) || typeof raw.duration !== 'number') return null;
  const scenes: PlanScene[] = [];
  for (const s of raw.scenes) {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.start !== 'number' || typeof s.end !== 'number') return null;
    if (typeof s.purpose !== 'string' || !Array.isArray(s.assets)) return null;
    const assets: PlanAsset[] = [];
    for (const a of s.assets) {
      const r = readAsset(a);
      if (!r) return null;
      assets.push(r);
    }
    scenes.push({
      id: s.id,
      start: s.start,
      end: s.end,
      purpose: s.purpose,
      script: str(s.script),
      layout: str(s.layout),
      ...(typeof s.grammar === 'string' ? { grammar: s.grammar } : {}),
      motion: str(s.motion),
      assets,
      ...(typeof s.fallback === 'string' ? { fallback: s.fallback } : {}),
    });
  }
  const st = raw.story;
  const est = raw.genEstimate;
  return {
    duration: raw.duration,
    ...(isObj(st) && typeof st.hook === 'string'
      ? { story: { hook: st.hook, idea: str(st.idea), payoff: str(st.payoff), cta: str(st.cta) } }
      : {}),
    scenes,
    ...(isObj(est) && typeof est.items === 'number' && typeof est.usd === 'number' ? { genEstimate: { items: est.items, usd: est.usd } } : {}),
  };
}

export interface QuoteItem {
  kind: 'image' | 'video';
  params: { prompt: string; refFrames?: string[]; seconds?: number };
}

/** Quote request items: one per asset with source 'gen' (image unless the asset says video). */
export function quoteItemsFor(plan: PlanView): QuoteItem[] {
  return plan.scenes.flatMap((s) =>
    s.assets.flatMap((a): QuoteItem[] =>
      a.source === 'gen' && a.prompt
        ? [
            {
              kind: a.kind ?? 'image',
              params: {
                prompt: a.prompt,
                ...(a.refFrames ? { refFrames: a.refFrames } : {}),
                ...(a.seconds !== undefined ? { seconds: a.seconds } : {}),
              },
            },
          ]
        : [],
    ),
  );
}

/** True when the quote says image/video generation has no provider configured. */
export function genUnavailable(missing: readonly string[]): boolean {
  return missing.includes('image') || missing.includes('video');
}

export const fmtUsd = (n: number): string => `$${n.toFixed(2)}`;

export function awaitingGenerate(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.type === 'generate' && t.status === 'awaiting_approval');
}

/** A generate task whose paid job may or may not have started: needs a manual provider check. */
export function hasUnknownState(t: Task): boolean {
  if (t.type !== 'generate') return false;
  if (t.status === 'failed' && typeof t.error === 'string' && t.error.includes('already_started')) return true;
  const hint = (v: unknown) => isObj(v) && v.hint === 'unknown_job_state';
  return hint(t.output) || t.progress.some((l) => l.includes('unknown_job_state'));
}

/** Plan review shows until a storyboard or execute is active or done; a failed newest one brings it back for a retry. */
export const showPlanReview = (tasks: Task[]): boolean => {
  const last = newestTask(tasks.filter((t) => t.type === 'execute' || t.type === 'storyboard'));
  return !last || last.status === 'failed';
};

/** useGen chosen at plan approval (carried by the newest storyboard task). */
export function storyboardUseGen(tasks: Task[]): boolean {
  return newestTask(tasks.filter((t) => t.type === 'storyboard'))?.input.useGen === true;
}

export const hasDirect = (tasks: Task[]): boolean => tasks.some((t) => t.type === 'direct');

/** Style ids for re-running the director: the newest direct task's, else the project's. */
export function directStyleIds(tasks: Task[], projectStyleIds: string[]): string[] {
  const ids = newestTask(tasks.filter((t) => t.type === 'direct'))?.input.styleIds;
  return Array.isArray(ids) && ids.every((x) => typeof x === 'string') ? (ids as string[]) : projectStyleIds;
}

/** "Davom etish" is on when no reference is still being studied and something usable exists. */
export function canContinue(tasks: Task[], pickedStyles: number): boolean {
  const refs = tasks.filter((t) => t.type === 'study_ref');
  if (refs.some((t) => t.status === 'queued' || t.status === 'running' || t.status === 'awaiting_approval')) return false;
  return refs.some((t) => t.status === 'done') || pickedStyles > 0;
}

export function stageLinks(id: string): { key: 'refs' | 'footage' | 'pipeline' | 'board' | 'edit'; label: string; href: string }[] {
  return [
    { key: 'refs', label: 'Namunalar', href: `#/p/${id}/refs` },
    { key: 'footage', label: 'Footaj', href: `#/p/${id}/footage` },
    { key: 'pipeline', label: 'Jarayon', href: `#/p/${id}` },
    { key: 'board', label: 'Storyboard', href: `#/p/${id}/board` },
    { key: 'edit', label: 'Muharrir', href: `#/p/${id}/edit` },
  ];
}

/** Chat log with an assistant reply after each user message whose edit task finished or failed. */
export function chatWithReplies(chat: ChatMsg[], tasks: Task[]): ChatMsg[] {
  const byMsg = new Map<string, Task>();
  for (const t of tasks) if (t.type === 'edit' && typeof t.input.msgId === 'string') byMsg.set(t.input.msgId, t);
  return chat.flatMap((m) => {
    const t = m.role === 'user' ? byMsg.get(m.id) : undefined;
    if (!t || (t.status !== 'done' && t.status !== 'failed')) return [m];
    const summary = isObj(t.output) && typeof t.output.summary === 'string' ? t.output.summary : '';
    const text = t.status === 'failed' ? `Xato: ${t.error ?? "noma'lum xato"}` : summary || 'Tayyor.';
    return [m, { id: `reply-${m.id}`, role: 'assistant' as const, text, at: m.at }];
  });
}

/** Style id written by the newest finished study, or null. */
export function studiedStyleId(tasks: Task[]): string | null {
  const t = newestTask(tasks.filter((x) => x.type === 'study_ref' && x.status === 'done'));
  const s = t?.input.styleId;
  return typeof s === 'string' && s ? s : null;
}

/** "O'rganishni boshlash" is on when no study is active and some ref is new or failed. */
export function canStudy(refs: { status: string }[], tasks: Task[]): boolean {
  if (tasks.some((t) => t.type === 'study_ref' && (t.status === 'queued' || t.status === 'running'))) return false;
  return refs.some((r) => r.status === 'added' || r.status === 'failed');
}

function hexToHsl(hex: string): { s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

/** Default accent: the most saturated mid-light palette colour (not the background). */
export function pickAccent(palette: string[]): string {
  const valid = palette.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
  if (valid.length === 0) return '#e5302a';
  let best = valid[0];
  let score = -1;
  for (const c of valid) {
    const { s, l } = hexToHsl(c);
    const v = s * (1 - Math.abs(l - 0.55) * 1.4);
    if (v > score) {
      score = v;
      best = c;
    }
  }
  return best.toLowerCase();
}

/** Parses "#aabbcc, #ddeeff" into valid hex colours (max 6). */
export function parsePalette(text: string): string[] {
  return (text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase()).slice(0, 6);
}

/** Style ids chosen on the References screen, handed to the Footage screen until `direct` is created. */
const STYLE_KEY = (id: string) => `motionable.styles.${id}`;
export function rememberStyles(id: string, styleIds: string[]): void {
  try {
    sessionStorage.setItem(STYLE_KEY(id), JSON.stringify(styleIds));
  } catch {
    // storage blocked: the Footage screen falls back to the studied style
  }
}
export function recalledStyles(id: string, tasks: Task[]): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(STYLE_KEY(id)) ?? 'null');
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  } catch {
    // fall through
  }
  const s = studiedStyleId(tasks);
  return s ? [s] : [];
}
