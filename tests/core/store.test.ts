import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { home, projectDir } from '../../src/core/paths.js';
import { ProjectSchema, type Project } from '../../src/core/types.js';
import { createProject, getLast, getProject, listProjects, readJson, setLast, slugId, writeJson } from '../../src/core/store.js';

beforeEach(async () => {
  process.env.MOTIONABLE_HOME = await mkdtemp(join(tmpdir(), 'motionable-'));
});

const valid: Project = { id: 'a-123456', name: 'A', brief: 'b', status: 'new', styleIds: [], createdAt: new Date().toISOString() };

describe('slugId', () => {
  test('keeps ascii and is unique', () => {
    const a = slugId('Uy qurish? 5 qadam / v2');
    const b = slugId('Uy qurish? 5 qadam / v2');
    expect(a).toMatch(/^uy-qurish-5-qadam-v2-[a-z0-9]{6}$/);
    expect(a).not.toBe(b);
  });
  test('emoji-only name still gives an id', () => expect(slugId('🎬')).toMatch(/^video-[a-z0-9]{6}$/));
});

describe('paths', () => {
  test('home reads env on every call', () => {
    process.env.MOTIONABLE_HOME = '/x/y';
    expect(home()).toBe('/x/y');
    process.env.MOTIONABLE_HOME = '/z';
    expect(home()).toBe('/z');
    expect(projectDir('p')).toBe('/z/projects/p');
  });
});

describe('writeJson', () => {
  test('rejects invalid data and leaves old file', async () => {
    const f = join(home(), 'p.json');
    await writeJson(f, ProjectSchema, valid);
    await expect(writeJson(f, ProjectSchema, { ...valid, name: 1 } as any)).rejects.toThrow();
    expect((await readJson(f, ProjectSchema)).name).toBe(valid.name);
    expect((await readdir(home())).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
});

describe('projects', () => {
  test('createProject keeps original name, sets last, makes dirs', async () => {
    const p = await createProject({ name: "Ko'chmas mulk", brief: 'x' });
    expect(p.name).toBe("Ko'chmas mulk");
    expect(await getLast()).toBe(p.id);
    for (const d of ['broll', 'refs', 'tasks', 'gen', 'renders']) {
      expect((await stat(join(projectDir(p.id), d))).isDirectory()).toBe(true);
    }
    expect((await getProject(p.id)).id).toBe(p.id);
    expect((await listProjects()).map((x) => x.id)).toEqual([p.id]);
  });
  test('getLast is null when unset; setLast roundtrips', async () => {
    expect(await getLast()).toBeNull();
    await setLast('abc');
    expect(await getLast()).toBe('abc');
  });
  test('listProjects empty when no projects dir', async () => {
    expect(await listProjects()).toEqual([]);
  });
});
