import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { home, projectDir } from './paths.js';
import { ProjectSchema, type Project } from './types.js';

const SUFFIX = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(n: number): string {
  const bytes = randomBytes(n);
  return Array.from(bytes, (b) => SUFFIX[b % SUFFIX.length]).join('');
}

/** ASCII slug plus 6 random chars. Falls back to "video" when nothing ascii is left. */
export function slugId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${slug || 'video'}-${randomSuffix(6)}`;
}

export async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(file, 'utf8')));
}

/** Validate, write to a temp file in the same dir, then rename over the target. */
export async function writeJson<T>(file: string, schema: z.ZodType<T>, value: T, mode?: number): Promise<void> {
  const data = schema.parse(value);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomSuffix(8)}`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), mode === undefined ? undefined : { mode });
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

const LastSchema = z.object({ projectId: z.string() });

export async function setLast(id: string): Promise<void> {
  await writeJson(join(home(), 'last.json'), LastSchema, { projectId: id });
}

export async function getLast(): Promise<string | null> {
  try {
    return (await readJson(join(home(), 'last.json'), LastSchema)).projectId;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function createProject(input: { name: string; brief: string; session?: string }): Promise<Project> {
  const project: Project = {
    id: slugId(input.name),
    name: input.name,
    brief: input.brief,
    status: 'new',
    styleIds: [],
    createdAt: new Date().toISOString(),
    ...(input.session ? { session: input.session } : {}),
  };
  const dir = projectDir(project.id);
  for (const d of ['broll', 'refs', 'tasks', 'gen', 'renders']) {
    await mkdir(join(dir, d), { recursive: true });
  }
  await writeJson(join(dir, 'project.json'), ProjectSchema, project);
  await setLast(project.id);
  return project;
}

export async function getProject(id: string): Promise<Project> {
  return readJson(join(projectDir(id), 'project.json'), ProjectSchema);
}

/** Bind a project to the chat that opened it, so only that chat's /motionable loop works its queue. */
export async function bindSession(id: string, session: string): Promise<Project> {
  const project = await getProject(id);
  if (project.session === session) return project;
  const next = { ...project, session };
  await writeJson(join(projectDir(id), 'project.json'), ProjectSchema, next);
  return next;
}

export async function listProjects(): Promise<Project[]> {
  let ids: string[];
  try {
    ids = await readdir(join(home(), 'projects'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const out: Project[] = [];
  for (const id of ids) {
    try {
      out.push(await getProject(id));
    } catch {
      // skip dirs without a valid project.json
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
