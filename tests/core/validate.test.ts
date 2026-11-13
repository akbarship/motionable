import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runSheet, runValidate } from '../../src/cli.js';

const fixtureFile = fileURLToPath(new URL('../fixtures/plan-v2.json', import.meta.url));
const fixture = async () => JSON.parse(await readFile(fixtureFile, 'utf8'));

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
  test('v2 fixture plan exits 0', async () => {
    expect(await runValidate('plan', fixtureFile)).toEqual({ code: 0, out: 'ok' });
  });

  test('gen asset without fallback exits 1 and names the path', async () => {
    const p = await fixture();
    delete p.scenes[1].assets[0].fallback;
    const r = await runValidate('plan', await put('bad-plan.json', p));
    expect(r.code).toBe(1);
    expect(r.out).toContain('scenes.1.assets.0.fallback');
  });

  test('timing, word-rate and message rules come back as short lines', async () => {
    const p = await fixture();
    p.scenes[1].start = 3; // gap
    p.scenes[0].script = 'bir ikki uch tort besh olti yetti sakkiz'; // 3.2 words/s
    p.scenes[2].layout = p.scenes[1].layout; // a repeated frame is allowed
    p.scenes[2].message = 'ekranda boshqa gap'; // not the spoken words
    const r = await runValidate('plan', await put('bad-plan-2.json', p));
    expect(r.code).toBe(1);
    expect(r.out).toContain('scenes.1.start');
    expect(r.out).toContain('scenes.0.script');
    expect(r.out).not.toContain('scenes.2.layout');
    expect(r.out).toContain('scenes.2.message');
  });

  test('old v1 plan (scene gen, no story) exits 1', async () => {
    const v1 = {
      format: { w: 1080, h: 1920, fps: 30 },
      duration: 3,
      styleIds: ['a'],
      captions: { on: true, style: 'kinetic', source: 'stt' },
      scenes: [{ id: 's1', start: 0, end: 3, purpose: 'hook', footage: null, components: [], gen: null }],
      audio: { voice: 'footage', music: null },
      genEstimate: { items: 0, usd: 0 },
    };
    const r = await runValidate('plan', await put('v1.json', v1));
    expect(r.code).toBe(1);
    expect(r.out).toContain('story');
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
      return { cuts: [1, 2], sheets: ['/o/sheet-1.jpg'], avgShot: 1.5, frames: [0.5, 1.5], frameFiles: [] };
    });
    expect(JSON.parse(out)).toEqual({ sheets: ['/o/sheet-1.jpg'], cuts: 2, avgShot: 1.5 });
  });
});
