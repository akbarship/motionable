import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runSheet, runValidate } from '../../src/cli.js';

const plan = (scene: Record<string, unknown>) => ({
  format: { w: 1080, h: 1920, fps: 30 },
  duration: 3,
  styleIds: ['a'],
  captions: { on: true, style: 'kinetic', source: 'stt' },
  scenes: [{ id: 's1', start: 0, end: 3, purpose: 'hook', footage: null, components: [], gen: null, ...scene }],
  audio: { voice: 'footage', music: null },
  genEstimate: { items: 0, usd: 0 },
});

let dir: string;
const put = async (name: string, v: unknown) => {
  const f = join(dir, name);
  await writeFile(f, typeof v === 'string' ? v : JSON.stringify(v));
  return f;
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'motionable-validate-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('motionable validate', () => {
  test('plan with gen but no fallback exits 1 and names the path', async () => {
    const f = await put('bad-plan.json', plan({ gen: { type: 'image', prompt: 'p' } }));
    const r = await runValidate('plan', f);
    expect(r.code).toBe(1);
    expect(r.out).toContain('scenes.0.fallback');
  });

  test('valid plan exits 0', async () => {
    const f = await put('plan.json', plan({ gen: { type: 'image', prompt: 'p' }, fallback: 'typography card' }));
    expect(await runValidate('plan', f)).toEqual({ code: 0, out: 'ok' });
  });

  test('words: valid array ok, wrong shape fails', async () => {
    expect((await runValidate('words', await put('w.json', [{ w: 'salom', start: 0, end: 0.4 }]))).code).toBe(0);
    expect((await runValidate('words', await put('w2.json', [{ w: 'salom' }]))).code).toBe(1);
  });

  test('style missing fields fails with a short list', async () => {
    const r = await runValidate('style', await put('s.json', { framing: 'centre' }));
    expect(r.code).toBe(1);
    expect(r.out.split('\n').length).toBeLessThanOrEqual(10);
  });

  test('bad JSON, missing file and unknown kind exit 1', async () => {
    expect((await runValidate('plan', await put('x.json', '{nope'))).code).toBe(1);
    expect((await runValidate('plan', join(dir, 'missing.json'))).code).toBe(1);
    expect((await runValidate('nope', await put('y.json', {}))).code).toBe(1);
  });
});

describe('motionable sheet', () => {
  test('prints sheet paths and cut count from the builder', async () => {
    const out = await runSheet('a.mp4', '/o', async (v, o) => {
      expect([v, o]).toEqual(['a.mp4', '/o']);
      return { cuts: [1, 2], sheets: ['/o/sheet-1.jpg'], avgShot: 1.5, frames: [0.5, 1.5] };
    });
    expect(JSON.parse(out)).toEqual({ sheets: ['/o/sheet-1.jpg'], cuts: 2, avgShot: 1.5 });
  });
});
