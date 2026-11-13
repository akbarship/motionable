import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { MAX_LESSONS, addLesson, allLessons, lessonsFile, readLessons, removeLesson } from '../../src/core/lessons.js';
import { home } from '../../src/core/paths.js';

beforeEach(async () => {
  process.env.MOTIONABLE_HOME = await mkdtemp(join(tmpdir(), 'motionable-lessons-'));
});

describe('lessons', () => {
  test('a missing file is an empty list', async () => {
    expect(await readLessons('global')).toEqual([]);
    expect(await allLessons()).toEqual([{ scope: 'global', lines: [] }]);
  });

  test('add writes one dated line and keeps it on one line', async () => {
    expect(await addLesson('global', '  Fon butun videoda\n bitta bo\'lsin ', '2026-11-13')).toEqual({ added: true, count: 1 });
    expect(await readLessons('global')).toEqual(["2026-11-13: Fon butun videoda bitta bo'lsin"]);
    expect(await readFile(lessonsFile('global'), 'utf8')).toContain("\n- 2026-11-13: Fon butun videoda bitta bo'lsin\n");
  });

  test('the same rule is not added twice (date, case and punctuation ignored)', async () => {
    await addLesson('global', "Soxta UI yo'q.", '2026-11-01');
    expect(await addLesson('global', "soxta ui yo'q", '2026-11-13')).toEqual({ added: false, count: 1 });
    expect(await readLessons('global')).toHaveLength(1);
  });

  test('the oldest rule drops off over the cap', async () => {
    for (let i = 0; i <= MAX_LESSONS; i++) await addLesson('global', `qoida ${i}`, '2026-11-13');
    const lines = await readLessons('global');
    expect(lines).toHaveLength(MAX_LESSONS);
    expect(lines[0]).toBe('2026-11-13: qoida 1');
    expect(lines.at(-1)).toBe(`2026-11-13: qoida ${MAX_LESSONS}`);
  });

  test('style lessons live with the style and are listed after global', async () => {
    await mkdir(join(home(), 'styles', 'my-style'), { recursive: true });
    await addLesson('my-style', 'Sarlavha faqat kichik harfda', '2026-11-13');
    await addLesson('global', 'Siz deb yozing', '2026-11-13');
    expect(lessonsFile('my-style')).toBe(join(home(), 'styles', 'my-style', 'lessons.md'));
    expect(await allLessons()).toEqual([
      { scope: 'global', lines: ['2026-11-13: Siz deb yozing'] },
      { scope: 'my-style', lines: ['2026-11-13: Sarlavha faqat kichik harfda'] },
    ]);
  });

  test('remove deletes one exact line', async () => {
    await addLesson('global', 'bir', '2026-11-13');
    await addLesson('global', 'ikki', '2026-11-13');
    expect(await removeLesson('global', 'yoq')).toBe(false);
    expect(await removeLesson('global', '2026-11-13: bir')).toBe(true);
    expect(await readLessons('global')).toEqual(['2026-11-13: ikki']);
  });

  test('empty text and a bad style id are refused', async () => {
    await expect(addLesson('global', '   ')).rejects.toThrow('empty');
    await expect(addLesson('../x', 'qoida')).rejects.toThrow('invalid id');
  });
});
