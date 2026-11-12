import { describe, expect, test } from 'vitest';
import type { Task } from '../../studio/src/api.js';
import {
  awaitingGenerate,
  canContinue,
  chatWithReplies,
  directStyleIds,
  hasDirect,
  stageLinks,
  genUnavailable,
  hasUnknownState,
  lastProgress,
  quoteItemsFor,
  readPlan,
  showPlanReview,
  stageState,
} from '../../studio/src/pipeline.js';

let n = 0;
const task = (type: Task['type'], status: Task['status'], extra: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  type,
  status,
  input: {},
  progress: [],
  output: null,
  error: null,
  createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  ...extra,
});

const scene = (id: string, gen: unknown = null) => ({
  id,
  start: 0,
  end: 3,
  purpose: 'hook',
  footage: null,
  components: [{ kind: 'title', description: 'big title', props: {} }],
  gen,
  ...(gen ? { fallback: 'stock' } : {}),
});

describe('stageState', () => {
  test('idle without tasks, newest task wins', () => {
    expect(stageState([], 'study')).toBe('idle');
    const ts = [task('study_ref', 'failed'), task('study_ref', 'running')];
    expect(stageState(ts, 'study')).toBe('running');
    expect(stageState([task('direct', 'awaiting_approval')], 'direct')).toBe('queued');
  });
  test('execute stage covers execute/edit/render/generate', () => {
    expect(stageState([task('execute', 'done'), task('generate', 'failed')], 'execute')).toBe('failed');
    expect(stageState([task('render', 'done')], 'execute')).toBe('done');
    expect(stageState([task('render', 'done')], 'direct')).toBe('idle');
  });
});

test('lastProgress keeps the last 5 lines', () => {
  const ts = [task('direct', 'running', { progress: ['1', '2', '3'] }), task('direct', 'running', { progress: ['4', '5', '6', '7'] })];
  expect(lastProgress(ts, 'direct')).toEqual(['3', '4', '5', '6', '7']);
});

describe('readPlan', () => {
  test('accepts valid plan, rejects junk', () => {
    const plan = readPlan({ duration: 6, scenes: [scene('s1'), scene('s2', { type: 'image', prompt: 'p', seconds: 2 })] });
    expect(plan?.scenes).toHaveLength(2);
    expect(plan?.scenes[1].gen).toEqual({ type: 'image', prompt: 'p', seconds: 2 });
    expect(readPlan(null)).toBeNull();
    expect(readPlan('x')).toBeNull();
    expect(readPlan({ duration: 1, scenes: [{ id: 's' }] })).toBeNull();
    expect(readPlan({ duration: 1, scenes: [scene('s', { type: 'audio', prompt: 'p' })] })).toBeNull();
  });
});

test('quoteItemsFor maps only gen scenes', () => {
  const plan = readPlan({
    duration: 9,
    scenes: [scene('a'), scene('b', { type: 'video', prompt: 'v', seconds: 4 }), scene('c', { type: 'image', prompt: 'i' })],
  })!;
  expect(quoteItemsFor(plan)).toEqual([
    { kind: 'video', params: { prompt: 'v', seconds: 4 } },
    { kind: 'image', params: { prompt: 'i' } },
  ]);
});

test('genUnavailable', () => {
  expect(genUnavailable([])).toBe(false);
  expect(genUnavailable(['tts'])).toBe(false);
  expect(genUnavailable(['video'])).toBe(true);
  expect(genUnavailable(['image', 'tts'])).toBe(true);
});

test('awaitingGenerate and showPlanReview', () => {
  const g = task('generate', 'awaiting_approval');
  expect(awaitingGenerate([g, task('generate', 'done'), task('execute', 'awaiting_approval')])).toEqual([g]);
  expect(showPlanReview([task('direct', 'done')])).toBe(true);
  expect(showPlanReview([task('execute', 'queued')])).toBe(false);
});

test('hasUnknownState', () => {
  expect(hasUnknownState(task('generate', 'failed', { error: 'already_started: job 1' }))).toBe(true);
  expect(hasUnknownState(task('generate', 'failed', { error: 'declined' }))).toBe(false);
  expect(hasUnknownState(task('generate', 'done', { output: { hint: 'unknown_job_state' } }))).toBe(true);
  expect(hasUnknownState(task('generate', 'running', { progress: ['hint: unknown_job_state'] }))).toBe(true);
  expect(hasUnknownState(task('execute', 'failed', { error: 'already_started' }))).toBe(false);
});

test('showPlanReview comes back when the newest execute failed', () => {
  expect(showPlanReview([task('execute', 'failed')])).toBe(true);
  expect(showPlanReview([task('execute', 'done'), task('execute', 'failed')])).toBe(true);
  expect(showPlanReview([task('execute', 'failed'), task('execute', 'running')])).toBe(false);
  expect(showPlanReview([task('execute', 'done')])).toBe(false);
});

test('directStyleIds and hasDirect', () => {
  expect(hasDirect([task('study_ref', 'done')])).toBe(false);
  const d = task('direct', 'done', { input: { styleIds: ['a', 'b'] } });
  expect(hasDirect([d])).toBe(true);
  expect(directStyleIds([d], ['z'])).toEqual(['a', 'b']);
  expect(directStyleIds([], ['z'])).toEqual(['z']);
  expect(directStyleIds([task('direct', 'done', { input: {} })], ['z'])).toEqual(['z']);
});

test('canContinue: one failed ref does not block', () => {
  const ok = task('study_ref', 'done');
  expect(canContinue([ok, task('study_ref', 'failed')], 0)).toBe(true);
  expect(canContinue([task('study_ref', 'failed')], 0)).toBe(false);
  expect(canContinue([ok, task('study_ref', 'running')], 0)).toBe(false);
  expect(canContinue([ok, task('study_ref', 'queued')], 1)).toBe(false);
  expect(canContinue([task('study_ref', 'failed')], 1)).toBe(true);
  expect(canContinue([task('direct', 'done')], 0)).toBe(false);
  expect(canContinue([], 0)).toBe(false);
});

test('stageLinks', () => {
  expect(stageLinks('p1')).toEqual([
    { key: 'refs', label: 'Namunalar', href: '#/p/p1/refs' },
    { key: 'pipeline', label: 'Jarayon', href: '#/p/p1' },
    { key: 'edit', label: 'Muharrir', href: '#/p/p1/edit' },
  ]);
});

test('chatWithReplies adds assistant replies from finished edit tasks', () => {
  const chat = [
    { id: 'm1', role: 'user' as const, text: 'a', at: 'x' },
    { id: 'm2', role: 'user' as const, text: 'b', at: 'x' },
    { id: 'm3', role: 'user' as const, text: 'c', at: 'x' },
  ];
  const tasks = [
    task('edit', 'done', { input: { msgId: 'm1' }, output: { summary: 'Sarlavha almashtirildi' } }),
    task('edit', 'failed', { input: { msgId: 'm2' }, error: 'comp topilmadi' }),
    task('edit', 'running', { input: { msgId: 'm3' } }),
  ];
  const out = chatWithReplies(chat, tasks);
  expect(out.map((m) => [m.id, m.role, m.text])).toEqual([
    ['m1', 'user', 'a'],
    ['reply-m1', 'assistant', 'Sarlavha almashtirildi'],
    ['m2', 'user', 'b'],
    ['reply-m2', 'assistant', 'Xato: comp topilmadi'],
    ['m3', 'user', 'c'],
  ]);
  const bare = chatWithReplies(chat.slice(0, 1), [task('edit', 'done', { input: { msgId: 'm1' }, output: null })]);
  expect(bare[1].text).toBe('Tayyor.');
});
