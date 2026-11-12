import { describe, expect, test } from 'vitest';
import type { Task } from '../../studio/src/api.js';
import {
  awaitingGenerate,
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
