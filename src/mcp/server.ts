import { execFile, spawn } from 'node:child_process';
import { mkdir, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { home, projectDir } from '../core/paths.js';
import { fail, finish, listTasks, progress, waitForTask } from '../core/queue.js';
import { getLast, getProject, readJson } from '../core/store.js';
import type { TaskType } from '../core/types.js';

const AGENTS: Record<TaskType, string> = {
  study_ref: 'ref-study',
  direct: 'director',
  execute: 'executor',
  edit: 'executor',
  render: 'executor',
  generate: 'executor',
};

const StudioInfoSchema = z.object({ port: z.number(), token: z.string(), pid: z.number() });
const HEARTBEAT_EVERY_MS = 30_000;

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });

async function touchHeartbeat(): Promise<void> {
  const f = join(home(), 'heartbeat');
  try {
    const now = new Date();
    await utimes(f, now, now);
  } catch {
    await mkdir(home(), { recursive: true });
    await writeFile(f, '');
  }
}

/** Open a URL in the default browser. execFile with arg arrays only. */
export function openBrowser(url: string): void {
  if (process.env.MOTIONABLE_NO_OPEN === '1') return;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  execFile(cmd, args, () => {}).on('error', () => {});
}

async function readStudio(): Promise<z.infer<typeof StudioInfoSchema> | null> {
  try {
    return await readJson(join(home(), 'studio.json'), StudioInfoSchema);
  } catch {
    return null;
  }
}

async function studioAlive(info: z.infer<typeof StudioInfoSchema>): Promise<boolean> {
  try {
    process.kill(info.pid, 0);
    const r = await fetch(`http://127.0.0.1:${info.port}/api/claude?t=${info.token}`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

function spawnStudio(): void {
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
  const child = spawn(process.execPath, [cli, 'studio'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** Returns the Studio url (with token), starting it when needed. `spawnFn` is injectable for tests. */
export async function ensureStudio(spawnFn: () => void = spawnStudio): Promise<string> {
  const urlOf = (i: z.infer<typeof StudioInfoSchema>) => `http://127.0.0.1:${i.port}/?t=${i.token}`;
  const cur = await readStudio();
  if (cur && (await studioAlive(cur))) return urlOf(cur);
  spawnFn();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const i = await readStudio();
    if (i && i.pid !== cur?.pid && (await studioAlive(i))) return urlOf(i);
  }
  throw new Error('studio did not start within 10 s');
}

export function createMcpServer(opts: { spawnStudio?: () => void } = {}): McpServer {
  const server = new McpServer({ name: 'motionable', version: '0.1.0' });
  /** taskId -> claim token from waitForTask. */
  const tokens = new Map<string, string>();

  server.registerTool(
    'studio_open',
    { description: 'Start Motionable Studio if needed and open it in the browser. Returns {url, projectId|null}.' },
    async () => {
      const url = await ensureStudio(opts.spawnStudio);
      const last = await getLast();
      openBrowser(last ? `${url}#/p/${last}` : url);
      return text({ url, projectId: last });
    },
  );

  server.registerTool(
    'next_task',
    {
      description:
        'Wait for the next queued task. Returns {projectId, taskId, type, input, projectDir, agent} or {idle:true}.',
    },
    async () => {
      await touchHeartbeat();
      const timer = setInterval(() => void touchHeartbeat().catch(() => {}), HEARTBEAT_EVERY_MS);
      try {
        const c = await waitForTask(Number(process.env.MOTIONABLE_WAIT_S ?? 240));
        if (!c) return text({ idle: true });
        tokens.set(c.task.id, c.token);
        return text({
          projectId: c.projectId,
          taskId: c.task.id,
          type: c.task.type,
          input: c.task.input,
          projectDir: projectDir(c.projectId),
          agent: AGENTS[c.task.type],
        });
      } finally {
        clearInterval(timer);
      }
    },
  );

  server.registerTool(
    'task_progress',
    {
      description: 'Append a short progress line to a running task.',
      inputSchema: { projectId: z.string(), taskId: z.string(), line: z.string() },
    },
    async ({ projectId, taskId, line }) => {
      await progress(projectId, taskId, line, tokens.get(taskId));
      return text({ ok: true });
    },
  );

  server.registerTool(
    'task_done',
    {
      description: 'Mark a task done with a short summary.',
      inputSchema: { projectId: z.string(), taskId: z.string(), summary: z.string() },
    },
    async ({ projectId, taskId, summary }) => {
      await finish(projectId, taskId, { summary }, tokens.get(taskId));
      tokens.delete(taskId);
      return text({ ok: true });
    },
  );

  server.registerTool(
    'task_failed',
    {
      description: 'Mark a task failed with an error message.',
      inputSchema: { projectId: z.string(), taskId: z.string(), error: z.string() },
    },
    async ({ projectId, taskId, error }) => {
      await fail(projectId, taskId, error, tokens.get(taskId));
      tokens.delete(taskId);
      return text({ ok: true });
    },
  );

  server.registerTool(
    'project_info',
    {
      description: 'Paths and status for a project.',
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) => {
      const p = await getProject(projectId);
      const dir = projectDir(projectId);
      const tasks = await listTasks(projectId);
      let hasPlan = true;
      try {
        await stat(join(dir, 'plan.json'));
      } catch {
        hasPlan = false;
      }
      return text({
        projectId,
        projectDir: dir,
        name: p.name,
        status: p.status,
        hasPlan,
        tasks: tasks.map((t) => ({ id: t.id, type: t.type, status: t.status })),
      });
    },
  );

  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await createMcpServer().connect(new StdioServerTransport());
}
