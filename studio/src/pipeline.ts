// Pure helpers for the pipeline screen: stage status, plan check, quote items, unknown-state detection.
import type { ChatMsg, Task } from './api.js';

export type StageId = 'study' | 'direct' | 'execute';
export type StageState = 'idle' | 'queued' | 'running' | 'done' | 'failed';

const STAGE_TYPES: Record<StageId, ReadonlySet<string>> = {
  study: new Set(['study_ref']),
  direct: new Set(['direct']),
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

export interface PlanScene {
  id: string;
  start: number;
  end: number;
  purpose: string;
  components: { kind: string; description: string }[];
  gen: { type: 'image' | 'video'; prompt: string; seconds?: number } | null;
  fallback?: string;
}
export interface PlanView {
  duration: number;
  scenes: PlanScene[];
  genEstimate?: { items: number; usd: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Light runtime check of plan.json (the server already validates on write). Null when unusable. */
export function readPlan(raw: unknown): PlanView | null {
  if (!isObj(raw) || !Array.isArray(raw.scenes) || typeof raw.duration !== 'number') return null;
  const scenes: PlanScene[] = [];
  for (const s of raw.scenes) {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.start !== 'number' || typeof s.end !== 'number') return null;
    if (typeof s.purpose !== 'string' || !Array.isArray(s.components)) return null;
    const components: PlanScene['components'] = [];
    for (const c of s.components) {
      if (!isObj(c) || typeof c.kind !== 'string' || typeof c.description !== 'string') return null;
      components.push({ kind: c.kind, description: c.description });
    }
    let gen: PlanScene['gen'] = null;
    if (s.gen != null) {
      const g = s.gen;
      if (!isObj(g) || (g.type !== 'image' && g.type !== 'video') || typeof g.prompt !== 'string') return null;
      gen = { type: g.type, prompt: g.prompt, ...(typeof g.seconds === 'number' ? { seconds: g.seconds } : {}) };
    }
    scenes.push({
      id: s.id,
      start: s.start,
      end: s.end,
      purpose: s.purpose,
      components,
      gen,
      ...(typeof s.fallback === 'string' ? { fallback: s.fallback } : {}),
    });
  }
  const est = raw.genEstimate;
  return {
    duration: raw.duration,
    scenes,
    ...(isObj(est) && typeof est.items === 'number' && typeof est.usd === 'number' ? { genEstimate: { items: est.items, usd: est.usd } } : {}),
  };
}

/** Quote request items: one per scene with gen. */
export function quoteItemsFor(plan: PlanView): { kind: 'image' | 'video'; params: { prompt: string; seconds?: number } }[] {
  return plan.scenes.flatMap((s) =>
    s.gen
      ? [{ kind: s.gen.type, params: { prompt: s.gen.prompt, ...(s.gen.seconds !== undefined ? { seconds: s.gen.seconds } : {}) } }]
      : [],
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

/** Plan review shows until an execute is active or done; a failed newest execute brings it back for a retry. */
export const showPlanReview = (tasks: Task[]): boolean => {
  const last = newestTask(tasks.filter((t) => t.type === 'execute'));
  return !last || last.status === 'failed';
};

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

export function stageLinks(id: string): { key: 'refs' | 'pipeline' | 'edit'; label: string; href: string }[] {
  return [
    { key: 'refs', label: 'Namunalar', href: `#/p/${id}/refs` },
    { key: 'pipeline', label: 'Jarayon', href: `#/p/${id}` },
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
