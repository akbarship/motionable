import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, realpath, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../core/config.js';
import { home, projectDir } from '../core/paths.js';
import { addTask, fail, finish, listTasks, progress, waitForTask } from '../core/queue.js';
import { getLast, getProject, readJson, writeJson } from '../core/store.js';
import { KindSchema, WordsSchema, type TaskType } from '../core/types.js';
import { providerFor as defaultProviderFor } from '../providers/registry.js';

const AGENTS: Record<TaskType, string> = {
  study_ref: 'ref-study',
  direct: 'director',
  execute: 'executor',
  edit: 'executor',
  render: 'executor',
  generate: 'executor',
};

const StudioInfoSchema = z.object({ port: z.number(), token: z.string(), pid: z.number() });
const waitSeconds = (): number => {
  const n = Number(process.env.MOTIONABLE_WAIT_S);
  return Number.isFinite(n) && n > 0 ? n : 240;
};
const HEARTBEAT_EVERY_MS = 30_000;
/** A fresh quote or final cost above approved * this is refused or flagged. */
const PRICE_SLACK = 1.2;

const idStr = z.string().regex(/^[a-z0-9-]+$/);
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
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
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

export function createMcpServer(
  opts: { spawnStudio?: () => void; providerFor?: typeof defaultProviderFor } = {},
): McpServer {
  const providerFor = opts.providerFor ?? defaultProviderFor;
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
    async (extra) => {
      await touchHeartbeat();
      const timer = setInterval(() => void touchHeartbeat().catch(() => {}), HEARTBEAT_EVERY_MS);
      try {
        const c = await waitForTask(waitSeconds(), 1000, extra.signal);
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
      inputSchema: { projectId: idStr, taskId: idStr, line: z.string() },
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
      inputSchema: { projectId: idStr, taskId: idStr, summary: z.string() },
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
      inputSchema: { projectId: idStr, taskId: idStr, error: z.string() },
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
      inputSchema: { projectId: idStr },
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

  server.registerTool(
    'request_generation',
    {
      description:
        'Ask for paid generation. Quotes it and queues a generate task that waits for the user Approve in Studio. Never runs anything. Returns {taskId, usd} or {error:"no_provider"}.',
      inputSchema: { projectId: idStr, sceneId: z.string(), kind: KindSchema, params: z.record(z.string(), z.unknown()) },
    },
    async ({ projectId, sceneId, kind, params }) => {
      await getProject(projectId);
      const cfg = await loadConfig();
      const p = providerFor(kind, cfg);
      if (!p) return text({ error: 'no_provider' });
      const { usd } = await p.quote({ kind, params, outDir: join(projectDir(projectId), 'gen') });
      const provider = cfg.providers[kind].use;
      const task = await addTask(projectId, 'generate', { sceneId, kind, params, usd, provider }, 'awaiting_approval');
      return text({ taskId: task.id, usd });
    },
  );

  server.registerTool(
    'generate',
    {
      description:
        'Run an approved generate task (status running) through the provider. Returns {file, usd, warning?} (file is project-relative) or {error}: not_approved, provider_changed, price_changed, already_started, already_generated.',
      inputSchema: { projectId: idStr, taskId: idStr },
    },
    async ({ projectId, taskId }) => {
      const task = (await listTasks(projectId)).find((t) => t.id === taskId);
      if (!task || task.type !== 'generate' || task.status !== 'running') return text({ error: 'not_approved' });
      const kind = KindSchema.safeParse(task.input.kind);
      const params = task.input.params;
      const approved = task.input.usd;
      if (!kind.success || typeof params !== 'object' || params === null || typeof approved !== 'number') {
        return text({ error: 'bad_task_input' });
      }
      const dir = projectDir(projectId);
      const genDir = join(dir, 'gen');
      const logFile = join(genDir, 'gen.log.jsonl');
      const startedFile = join(genDir, `${taskId}.started`);
      const prior = await readFile(logFile, 'utf8').catch(() => '');
      if (prior.split('\n').some((l) => l.includes(`"taskId":"${taskId}"`))) return text({ error: 'already_generated' });

      // What the user approved: same provider, and roughly the same price.
      const cfg = await loadConfig();
      const use = cfg.providers[kind.data].use;
      if (task.input.provider !== use) return text({ error: 'provider_changed' });
      const p = providerFor(kind.data, cfg);
      if (!p) return text({ error: 'no_provider' });

      // A leftover .started with a job id means an earlier run paid but did not finish: resume that job.
      let resumeJobId: string | undefined;
      const left = await readFile(startedFile, 'utf8').catch(() => null);
      if (left !== null) {
        try {
          const id = (JSON.parse(left) as { jobId?: unknown }).jobId;
          if (typeof id === 'string' && id) resumeJobId = id;
        } catch {
          // empty or torn marker: treated as started without a job
        }
        if (!resumeJobId) return text({ error: 'already_started', hint: 'unknown_job_state' });
      } else {
        const req = { kind: kind.data, params: params as Record<string, unknown>, outDir: genDir };
        const q = await p.quote(req);
        if (q.usd > approved * PRICE_SLACK) return text({ error: 'price_changed', usd: q.usd });
        await mkdir(genDir, { recursive: true });
        try {
          await writeFile(startedFile, '', { flag: 'wx' });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EEXIST') return text({ error: 'already_started' });
          throw e;
        }
      }

      let jobId = resumeJobId;
      let attempted = false;
      let r: { file: string; usd: number };
      try {
        r = await p.run({
          kind: kind.data,
          params: params as Record<string, unknown>,
          outDir: genDir,
          taskId,
          resumeJobId,
          onCreateAttempt: () => {
            attempted = true;
          },
          onJobId: async (id) => {
            jobId = id;
            await writeFile(startedFile, JSON.stringify({ jobId: id }));
          },
        });
      } catch (e) {
        // Only a failure before the create request is safe to retry. After it the job state is unknown: keep the marker.
        if (!jobId && !attempted) await unlink(startedFile).catch(() => {});
        throw e;
      }
      const file = relative(dir, r.file).split('\\').join('/');
      const warning = r.usd > approved * PRICE_SLACK ? 'price_exceeded' : undefined;
      await appendFile(
        logFile,
        JSON.stringify({
          taskId,
          kind: kind.data,
          provider: use,
          usd: r.usd,
          file,
          at: new Date().toISOString(),
          ...(warning ? { warning } : {}),
        }) + '\n',
      );
      return text({ file, usd: r.usd, ...(warning ? { warning } : {}) });
    },
  );

  server.registerTool(
    'transcribe',
    {
      description:
        'Speech to text for a project media file (project-relative path). Writes <base>.words.json next to it. Returns {wordsPath} or {error:"no_stt_provider"}.',
      inputSchema: { projectId: idStr, file: z.string().min(1) },
    },
    async ({ projectId, file }) => {
      const dir = projectDir(projectId);
      const abs = resolve(dir, file);
      const inside = (base: string, p: string) => {
        const rel = relative(base, p);
        return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
      };
      if (isAbsolute(file) || !inside(dir, abs)) throw new Error('file must be inside the project');
      const real = await realpath(abs);
      if (!inside(await realpath(dir), real)) throw new Error('file must be inside the project');
      const p = providerFor('stt', await loadConfig());
      if (!p?.transcribe) return text({ error: 'no_stt_provider' });
      const words = await p.transcribe(real);
      const wordsPath = join(dirname(abs), `${basename(abs, extname(abs))}.words.json`);
      await writeJson(wordsPath, WordsSchema, words);
      return text({ wordsPath: relative(dir, wordsPath).split('\\').join('/') });
    },
  );

  return server;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await createMcpServer().connect(new StdioServerTransport());
}
