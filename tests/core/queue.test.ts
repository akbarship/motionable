import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { projectDir } from '../../src/core/paths.js';
import { createProject } from '../../src/core/store.js';
import { addTask, approve, claimNext, fail, finish, listTasks, progress, waitForTask } from '../../src/core/queue.js';

let prev: string | undefined;
let tmp: string;
let p: string;

beforeEach(async () => {
  prev = process.env.MOTIONABLE_HOME;
  tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
  process.env.MOTIONABLE_HOME = tmp;
  p = (await createProject({ name: 'Q', brief: 'b' })).id;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prev;
  await rm(tmp, { recursive: true, force: true });
});

const lockPath = (id: string) => join(projectDir(p), 'tasks', `${id}.lock`);

describe('queue', () => {
  test('two parallel claims never get the same task', async () => {
    await addTask(p, 'study_ref', {});
    await addTask(p, 'study_ref', {});
    const [a, b] = await Promise.all([claimNext(), claimNext()]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.task.id).not.toBe(b!.task.id);
  });

  test('many parallel claims on one task: exactly one wins', async () => {
    await addTask(p, 'study_ref', {});
    const r = await Promise.all(Array.from({ length: 8 }, () => claimNext()));
    expect(r.filter(Boolean)).toHaveLength(1);
  });

  test('claims oldest first and marks running', async () => {
    const a = await addTask(p, 'direct', {});
    await addTask(p, 'direct', {});
    const c = await claimNext();
    expect(c!.task.id).toBe(a.id);
    expect(c!.task.status).toBe('running');
    expect((await listTasks(p)).find((t) => t.id === a.id)!.status).toBe('running');
  });

  test('edit waits while execute runs in same project', async () => {
    await addTask(p, 'execute', {});
    await claimNext();
    await addTask(p, 'edit', { msg: 'x' });
    expect(await claimNext()).toBeNull();
  });

  test('generate is in the exclusive set; study_ref and direct are not blocked', async () => {
    await addTask(p, 'generate', {});
    await claimNext();
    await addTask(p, 'render', {});
    expect(await claimNext()).toBeNull();
    const s = await addTask(p, 'study_ref', {});
    expect((await claimNext())!.task.id).toBe(s.id);
    const d = await addTask(p, 'direct', {});
    expect((await claimNext())!.task.id).toBe(d.id);
  });

  test('exclusivity is per project', async () => {
    await addTask(p, 'execute', {});
    await claimNext();
    const p2 = (await createProject({ name: 'Q2', brief: 'b' })).id;
    const t = await addTask(p2, 'edit', {});
    expect((await claimNext())!.task.id).toBe(t.id);
  });

  test('finish unblocks exclusive set and removes lock', async () => {
    const e = await addTask(p, 'execute', {});
    await claimNext();
    await addTask(p, 'edit', {});
    await finish(p, e.id, { ok: 1 });
    await expect(stat(lockPath(e.id))).rejects.toThrow();
    const t = (await listTasks(p)).find((x) => x.id === e.id)!;
    expect(t.status).toBe('done');
    expect(t.output).toEqual({ ok: 1 });
    expect(await claimNext()).not.toBeNull();
  });

  test('fail sets error and removes lock', async () => {
    const e = await addTask(p, 'edit', {});
    await claimNext();
    await fail(p, e.id, 'boom');
    await expect(stat(lockPath(e.id))).rejects.toThrow();
    const t = (await listTasks(p))[0]!;
    expect(t.status).toBe('failed');
    expect(t.error).toBe('boom');
  });

  test('awaiting_approval is not claimable until approve', async () => {
    const t = await addTask(p, 'generate', {}, 'awaiting_approval');
    expect(await claimNext()).toBeNull();
    await approve(p, t.id);
    expect((await claimNext())!.task.id).toBe(t.id);
  });

  test('stale lock (>30 min, running) is reclaimable; fresh lock is not', async () => {
    const t = await addTask(p, 'study_ref', {});
    await claimNext();
    // reset to queued-looking is not needed: stale reclaim targets a running task
    expect(await claimNext()).toBeNull();
    const old = new Date(Date.now() - 31 * 60_000);
    await utimes(lockPath(t.id), old, old);
    const c = await claimNext();
    expect(c!.task.id).toBe(t.id);
    expect(c!.task.status).toBe('running');
  });

  test('lock left behind for a done task is not reclaimed', async () => {
    const t = await addTask(p, 'study_ref', {});
    await claimNext();
    await finish(p, t.id, {});
    await writeFile(lockPath(t.id), '');
    const old = new Date(Date.now() - 31 * 60_000);
    await utimes(lockPath(t.id), old, old);
    expect(await claimNext()).toBeNull();
  });

  test('progress lines append in order', async () => {
    const t = await addTask(p, 'study_ref', {});
    await progress(p, t.id, 'one');
    await progress(p, t.id, 'two');
    expect((await listTasks(p))[0]!.progress).toEqual(['one', 'two']);
  });

  test('ids sort by creation order', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await addTask(p, 'direct', {})).id);
    expect([...ids].sort()).toEqual(ids);
    expect((await listTasks(p)).map((t) => t.id)).toEqual(ids);
  });

  test('waitForTask returns null on timeout and picks up a later task', async () => {
    expect(await waitForTask(0.05, 10)).toBeNull();
    const w = waitForTask(2, 10);
    setTimeout(() => void addTask(p, 'direct', {}), 30);
    expect((await w)!.task.type).toBe('direct');
  });
});

test('two queued exclusive tasks claimed in parallel: only one runs', async () => {
  await addTask(p, 'edit', {});
  await addTask(p, 'render', {});
  const r = await Promise.all([claimNext(), claimNext()]);
  expect(r.filter(Boolean)).toHaveLength(1);
});

test('progress refreshes the lock so a long task is not reclaimed', async () => {
  const t = await addTask(p, 'render', {});
  const c = await claimNext();
  const old = new Date(Date.now() - 31 * 60_000);
  await utimes(lockPath(t.id), old, old);
  await progress(p, t.id, 'still alive', c!.token);
  expect(await claimNext()).toBeNull();
  expect((await listTasks(p))[0]!.status).toBe('running');
});

test('two concurrent stale reclaims return the task at most once', async () => {
  const t = await addTask(p, 'study_ref', {});
  await claimNext();
  const old = new Date(Date.now() - 31 * 60_000);
  await utimes(lockPath(t.id), old, old);
  const r = await Promise.all(Array.from({ length: 6 }, () => claimNext()));
  expect(r.filter(Boolean)).toHaveLength(1);
});

test('old worker cannot finish or unlock after its task was reclaimed', async () => {
  const t = await addTask(p, 'study_ref', {});
  const a = await claimNext();
  const old = new Date(Date.now() - 31 * 60_000);
  await utimes(lockPath(t.id), old, old);
  const b = await claimNext();
  expect(b!.token).not.toBe(a!.token);
  await expect(finish(p, t.id, {}, a!.token)).rejects.toThrow();
  await stat(lockPath(t.id));
  expect((await listTasks(p))[0]!.status).toBe('running');
  await finish(p, t.id, { ok: 1 }, b!.token);
  expect((await listTasks(p))[0]!.status).toBe('done');
});
