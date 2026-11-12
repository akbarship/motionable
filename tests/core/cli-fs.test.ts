import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCopySheets, runHf } from '../../src/cli.js';
import { validateHfArgs } from '../../src/core/hf-cmd.js';
import { assertInHome } from '../../src/core/paths.js';
import { probe } from '../../src/media/ingest.js';

let root: string;
let outside: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mh-'));
  outside = mkdtempSync(join(tmpdir(), 'out-'));
  process.env.MOTIONABLE_HOME = root;
});
afterEach(() => {
  delete process.env.MOTIONABLE_HOME;
  delete process.env.MOTIONABLE_HF_BIN;
});

describe('assertInHome', () => {
  test('accepts inside, incl. not-yet-existing', () => {
    expect(assertInHome(join(root, 'styles', 'x', 'sheets'))).toContain('styles');
  });
  test('rejects ../ and outside', () => {
    expect(() => assertInHome(join(root, '..', 'x'))).toThrow();
    expect(() => assertInHome(outside)).toThrow();
  });
  test('rejects symlink escape', () => {
    symlinkSync(outside, join(root, 'link'));
    expect(() => assertInHome(join(root, 'link', 'f.txt'))).toThrow();
  });
});

describe('copy-sheets', () => {
  test('copies sheet-*.jpg only', async () => {
    const d = join(root, 'projects', 'p', 'ref.sheet');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'sheet-1.jpg'), 'a');
    writeFileSync(join(d, 'cuts.json'), '{}');
    const r = await runCopySheets(d, 'k1');
    expect(r.copied).toEqual(['sheets/sheet-1.jpg']);
    expect(readdirSync(join(root, 'styles', 'k1', 'sheets'))).toEqual(['sheet-1.jpg']);
  });
  test('copies frames/ too', async () => {
    const d = join(root, 'projects', 'p', 'ref2.sheet');
    mkdirSync(join(d, 'frames'), { recursive: true });
    writeFileSync(join(d, 'sheet-1.jpg'), 'a');
    writeFileSync(join(d, 'frames', 'f-012.4.jpg'), 'b');
    const r = await runCopySheets(d, 'k2');
    expect(r.frames).toEqual(['frames/f-012.4.jpg']);
    expect(readdirSync(join(root, 'styles', 'k2', 'frames'))).toEqual(['f-012.4.jpg']);
  });
  test('rejects outside paths and bad ids', async () => {
    await expect(runCopySheets(outside, 'k1')).rejects.toThrow();
    mkdirSync(join(root, 'a'));
    await expect(runCopySheets(join(root, 'a'), '../x')).rejects.toThrow();
  });
});

describe('probe', () => {
  test('reads a lavfi clip', async () => {
    const f = join(root, 't.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=d=1:s=64x48:r=10', '-f', 'lavfi', '-i', 'sine=d=1', '-shortest', '-y', f]);
    const p = await probe(f);
    expect(p).toMatchObject({ w: 64, h: 48, fps: 10, hasAudio: true });
    expect(p.duration).toBeGreaterThan(0.5);
  });
});

describe('validateHfArgs', () => {
  test('posix passes anything', () => {
    expect(validateHfArgs('linux', ['a b', '&&'])).toEqual(['a b', '&&']);
  });
  test('win32 rejects shell metacharacters', () => {
    expect(() => validateHfArgs('win32', ['render', '--output', 'C:/x/a.mp4'])).not.toThrow();
    for (const bad of ['a&b', 'a b', '$(x)', 'a|b', '"x"', 'a;b', '`x`', '>x'])
      expect(() => validateHfArgs('win32', [bad])).toThrow();
  });
});

describe('hf', () => {
  test('runs in comp/ and passes args', async () => {
    const proj = join(root, 'projects', 'p');
    mkdirSync(join(proj, 'comp'), { recursive: true });
    const bin = join(root, 'fake.sh');
    writeFileSync(bin, '#!/bin/sh\npwd > out.txt\necho "$@" >> out.txt\nexit 3\n');
    chmodSync(bin, 0o755);
    process.env.MOTIONABLE_HF_BIN = bin;
    const code = await runHf(proj, ['render', '--quality', 'draft'], 'linux', 'ignore');
    expect(code).toBe(3);
    const out = readFileSync(join(proj, 'comp', 'out.txt'), 'utf8');
    expect(out).toContain('comp');
    expect(out).toContain('render --quality draft');
    expect(readdirSync(proj)).toContain('renders');
  });
  test('init runs in project dir as `init comp`', async () => {
    const proj = join(root, 'projects', 'q');
    mkdirSync(proj, { recursive: true });
    const bin = join(root, 'fake2.sh');
    writeFileSync(bin, '#!/bin/sh\necho "$@" > out.txt\n');
    chmodSync(bin, 0o755);
    process.env.MOTIONABLE_HF_BIN = bin;
    expect(await runHf(proj, ['init'], 'linux', 'ignore')).toBe(0);
    expect(readFileSync(join(proj, 'out.txt'), 'utf8').trim()).toBe('init comp');
  });
  test('rejects project outside home and --output outside', async () => {
    await expect(runHf(outside, ['lint'], 'linux', 'ignore')).rejects.toThrow();
    mkdirSync(join(root, 'projects', 'r'), { recursive: true });
    await expect(runHf(join(root, 'projects', 'r'), ['render', '--output', join(outside, 'a.mp4')], 'linux', 'ignore')).rejects.toThrow();
  });
});
