import { randomBytes } from 'node:crypto';
import { readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertId, projectDir } from './paths.js';
import { listProjects, readJson, writeJson } from './store.js';
import { TaskSchema, type Task, type TaskType } from './types.js';

/** Types that cannot run at the same time inside one project. */
const EXCLUSIVE: ReadonlySet<TaskType> = new Set<TaskType>(['roughcut', 'storyboard', 'storyboard_edit', 'execute', 'edit', 'render', 'generate']);
const STALE_LOCK_MS = 30 * 60_000;

let lastMs = 0;
let seq = 0;

/** Time-prefixed id: fixed-width base36 ms + in-process counter + random tail, so ids sort by creation. */
function newTaskId(): { id: string; ms: number } {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    seq = 0;
  } else {
    seq += 1;
  }
  const id = `${lastMs.toString(36).padStart(9, '0')}${seq.toString(36).padStart(3, '0')}-${randomBytes(3).toString('hex')}`;
  return { id, ms: lastMs };
}

const tasksDir = (projectId: string) => join(projectDir(projectId), 'tasks');
const taskFile = (projectId: string, taskId: string) => join(tasksDir(projectId), `${assertId(taskId)}.json`);
const lockFile = (projectId: string, taskId: string) => join(tasksDir(projectId), `${assertId(taskId)}.lock`);

export async function addTask(
  projectId: string,
  type: TaskType,
  input: Record<string, unknown>,
  status: 'queued' | 'awaiting_approval' = 'queued',
): Promise<Task> {
  const { id, ms } = newTaskId();
  const task: Task = {
    id,
    type,
    status,
    input,
    progress: [],
    output: null,
    error: null,
    createdAt: new Date(ms).toISOString(),
  };
  await writeJson(taskFile(projectId, id), TaskSchema, task);
  return task;
}

export async function listTasks(projectId: string): Promise<Task[]> {
  let names: string[];
  try {
    names = await readdir(tasksDir(projectId));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: Task[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      out.push(await readJson(join(tasksDir(projectId), n), TaskSchema));
    } catch {
      // skip unreadable or half-written files
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function update(projectId: string, taskId: string, fn: (t: Task) => Task): Promise<Task> {
  const file = taskFile(projectId, taskId);
  const next = fn(await readJson(file, TaskSchema));
  await writeJson(file, TaskSchema, next);
  return next;
}

/** True when the task's lock still carries `token` (no other worker reclaimed it). */
export async function ownsLock(projectId: string, taskId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    return (await readFile(lockFile(projectId, taskId), 'utf8')) === token;
  } catch {
    return false;
  }
}

/** Throws when a token is given and the lock no longer carries it (task was reclaimed). */
async function assertOwner(projectId: string, taskId: string, token?: string): Promise<void> {
  if (token === undefined) return;
  let held: string | null = null;
  try {
    held = await readFile(lockFile(projectId, taskId), 'utf8');
  } catch {
    // missing lock counts as lost
  }
  if (held !== token) throw new Error(`lock for task ${taskId} is no longer owned by this worker`);
}

/** Unlink the lock only when it is ours (or when no token is supplied). */
async function release(projectId: string, taskId: string, token?: string): Promise<void> {
  try {
    await assertOwner(projectId, taskId, token);
  } catch {
    return;
  }
  await unlink(lockFile(projectId, taskId)).catch(() => {});
}

/** Appends a line and refreshes the lock mtime (heartbeat). `token` is the optional claim token. */
export async function progress(projectId: string, taskId: string, line: string, token?: string): Promise<void> {
  await assertOwner(projectId, taskId, token);
  await update(projectId, taskId, (t) => ({ ...t, progress: [...t.progress, line] }));
  const now = new Date();
  await utimes(lockFile(projectId, taskId), now, now).catch(() => {});
}

export async function finish(
  projectId: string,
  taskId: string,
  output: Record<string, unknown>,
  token?: string,
): Promise<void> {
  await assertOwner(projectId, taskId, token);
  await update(projectId, taskId, (t) => ({ ...t, status: 'done', output, error: null }));
  await release(projectId, taskId, token);
}

export async function fail(projectId: string, taskId: string, error: string, token?: string): Promise<void> {
  await assertOwner(projectId, taskId, token);
  await update(projectId, taskId, (t) => ({ ...t, status: 'failed', error }));
  await release(projectId, taskId, token);
}

export async function approve(projectId: string, taskId: string): Promise<void> {
  await update(projectId, taskId, (t) => (t.status === 'awaiting_approval' ? { ...t, status: 'queued' } : t));
}

async function lockAgeMs(projectId: string, taskId: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(lockFile(projectId, taskId))).mtimeMs;
  } catch {
    return null;
  }
}

/** Create the file exclusively, writing the owner token. Returns false when it already exists. */
async function tryLock(file: string, token = ''): Promise<boolean> {
  try {
    await writeFile(file, token, { flag: 'wx' });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

/** Take a short-lived mutex; a leftover older than 30 s (crashed claimer) is cleared. */
async function takeMutex(file: string): Promise<boolean> {
  if (await tryLock(file)) return true;
  try {
    if (Date.now() - (await stat(file)).mtimeMs > 30_000) {
      await unlink(file);
      return await tryLock(file);
    }
  } catch {
    // vanished or raced, caller retries on next poll
  }
  return false;
}

/** False only when the pid surely no longer exists (EPERM means it lives under another user). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** A running task's lock is stale when it is old or its owner process (pid in the token) has exited. */
async function lockStale(projectId: string, taskId: string): Promise<boolean> {
  const age = await lockAgeMs(projectId, taskId);
  if (age === null) return false;
  if (age > STALE_LOCK_MS) return true;
  let held = '';
  try {
    held = await readFile(lockFile(projectId, taskId), 'utf8');
  } catch {
    return false;
  }
  const pid = Number(/^(\d+)-/.exec(held)?.[1]);
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && !pidAlive(pid);
}

/** A task is claimable when queued, or running with a stale lock (dead worker). */
async function claimable(projectId: string, t: Task, runningExclusive: boolean): Promise<'fresh' | 'stale' | null> {
  if (t.status === 'queued') {
    if (EXCLUSIVE.has(t.type) && runningExclusive) return null;
    return 'fresh';
  }
  if (t.status === 'running' && (await lockStale(projectId, t.id))) return 'stale';
  return null;
}

/**
 * Claim the oldest claimable task. With `session`, only projects bound to that chat are looked at,
 * so a new chat never picks up another chat's (or an unopened old project's) work.
 */
export async function claimNext(
  opts: { session?: string } = {},
): Promise<{ projectId: string; task: Task; token: string } | null> {
  const candidates: { projectId: string; task: Task; running: boolean }[] = [];
  for (const project of await listProjects()) {
    if (opts.session !== undefined && project.session !== opts.session) continue;
    const tasks = await listTasks(project.id);
    const running = tasks.some((t) => t.status === 'running' && EXCLUSIVE.has(t.type));
    for (const task of tasks) candidates.push({ projectId: project.id, task, running });
  }
  candidates.sort((a, b) => a.task.createdAt.localeCompare(b.task.createdAt) || a.task.id.localeCompare(b.task.id));

  for (const { projectId, task, running } of candidates) {
    const kind = await claimable(projectId, task, running);
    if (!kind) continue;
    const lock = lockFile(projectId, task.id);
    const token = `${process.pid}-${randomBytes(8).toString('hex')}`;
    if (kind === 'stale') {
      // Reclaim under the project mutex and re-check the age there, so only one reclaimer wins.
      const m = join(tasksDir(projectId), '_exclusive.mutex');
      if (!(await takeMutex(m))) continue;
      try {
        if (!(await lockStale(projectId, task.id))) continue;
        await unlink(lock).catch(() => {});
        if (!(await tryLock(lock, token))) continue;
      } finally {
        await unlink(m).catch(() => {});
      }
    } else if (!(await tryLock(lock, token))) continue;

    // Lock held: re-read, another process may have changed the task meanwhile.
    let fresh: Task;
    try {
      fresh = await readJson(taskFile(projectId, task.id), TaskSchema);
    } catch {
      await release(projectId, task.id, token);
      continue;
    }
    const ok = kind === 'stale' ? fresh.status === 'running' : fresh.status === 'queued';
    if (!ok) {
      await release(projectId, task.id, token);
      continue;
    }
    let mutex: string | null = null;
    if (kind === 'fresh' && EXCLUSIVE.has(fresh.type)) {
      // Short project mutex so two exclusive tasks cannot both pass the check at once.
      mutex = join(tasksDir(projectId), '_exclusive.mutex');
      if (!(await takeMutex(mutex))) {
        await release(projectId, task.id, token);
        continue;
      }
      const now = await listTasks(projectId);
      if (now.some((t) => t.id !== fresh.id && t.status === 'running' && EXCLUSIVE.has(t.type))) {
        await unlink(mutex).catch(() => {});
        await release(projectId, task.id, token);
        continue;
      }
    }
    let running_: Task;
    try {
      running_ = await update(projectId, task.id, (t) => ({ ...t, status: 'running' }));
    } finally {
      if (mutex) await unlink(mutex).catch(() => {});
    }
    return { projectId, task: running_, token };
  }
  return null;
}

/** Put a claimed task back to queued, only while the lock still carries our token. Always tries a token-checked release. */
async function requeueClaim(projectId: string, taskId: string, token: string): Promise<void> {
  try {
    await assertOwner(projectId, taskId, token);
    await update(projectId, taskId, (t) => ({ ...t, status: 'queued' }));
  } catch {
    // lost ownership or write failed: do not touch another worker's task
  } finally {
    await release(projectId, taskId, token);
  }
}

/**
 * Poll claimNext until a task is claimed or timeoutS passes. pollMs is injectable for tests.
 * When `signal` aborts, polling stops and null is returned; a claim that lands after the abort is put back to queued.
 */
export async function waitForTask(
  timeoutS: number,
  pollMs = 1000,
  signal?: AbortSignal,
  claim: typeof claimNext = claimNext,
): Promise<{ projectId: string; task: Task; token: string } | null> {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    if (signal?.aborted) return null;
    const c = await claim();
    if (c) {
      if (!signal?.aborted) return c;
      await requeueClaim(c.projectId, c.task.id, c.token);
      return null;
    }
    if (Date.now() >= deadline) return null;
    await new Promise<void>((r) => {
      const t = setTimeout(done, Math.min(pollMs, Math.max(1, deadline - Date.now())));
      function done() {
        clearTimeout(t);
        signal?.removeEventListener('abort', done);
        r();
      }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
