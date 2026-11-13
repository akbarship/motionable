import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runPaletteCheck } from '../../src/cli.js';
import { createProject } from '../../src/core/store.js';
import { projectDir } from '../../src/core/paths.js';
import { deltaE, extractColours, isNeutral, paletteOffenders } from '../../src/media/palette.js';

let tmp: string;
const prev = process.env.MOTIONABLE_HOME;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'motionable-pal-'));
  process.env.MOTIONABLE_HOME = tmp;
});
afterEach(async () => {
  if (prev === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prev;
  await rm(tmp, { recursive: true, force: true });
});

describe('palette helpers', () => {
  test('extracts hex and rgb colours', () => {
    expect(extractColours('a{color:#FFF;background:#1e5bff80} b{fill:rgba(124, 58, 237, .5)} #abcd #12345')).toEqual(
      expect.arrayContaining(['#ffffff', '#1e5bff', '#7c3aed', '#aabbcc']),
    );
    expect(extractColours('#12345')).toEqual([]);
    expect(extractColours('.dot{background:#ff5f57} /* palette-ok: macOS window dot */\n.x{color:#1e5bff}')).toEqual(['#1e5bff']);
  });
  test('neutrals and distance', () => {
    expect(isNeutral('#f4f1ea')).toBe(true);
    expect(isNeutral('#7c3aed')).toBe(false);
    expect(deltaE('#1e5bff', '#1e5bff')).toBe(0);
    expect(deltaE('#1e5bff', '#7c3aed')).toBeGreaterThan(12);
  });
  test('purple is flagged against a blue palette; near shades and greys pass', () => {
    const found = new Map([
      ['#7c3aed', ['index.html']],
      ['#2060ff', ['a.css']],
      ['#333333', ['a.css']],
    ]);
    const off = paletteOffenders(found, ['#0b1a3a', '#1e5bff']);
    expect(off.map((o) => o.colour)).toEqual(['#7c3aed']);
    expect(off[0].nearest).toBe('#1e5bff');
  });
});

describe('palette-check', () => {
  async function setup(answers?: object) {
    const p = await createProject({ name: 'P', brief: '' });
    const dir = projectDir(p.id);
    const style = {
      pace: { avgShotSeconds: 2, cutsPerMin: 30 }, framing: 'c',
      captions: { fontFamily: 'Inter', weight: 700, case: 'sentence', position: 'low', highlight: 'x', wordsPerLine: 3 },
      textCards: { when: 'x', look: 'x' }, transitions: [], colour: { palette: ['#0b1a3a', '#1e5bff'], grade: 'x' },
      motion: [], audio: { musicEnergy: 'x', sfx: 'x' }, doNot: [], sheets: [],
      background: { kind: 'bokeh', stops: ['#0b1a3a', '#1e5bff'], blobs: [{ colour: '#3b7bff', x: 0.2, y: 0.3, r: 200, blur: 80 }] },
    };
    await mkdir(join(tmp, 'styles', 's1'), { recursive: true });
    await writeFile(join(tmp, 'styles', 's1', 'style.json'), JSON.stringify(style));
    await writeFile(join(dir, 'project.json'), JSON.stringify({ ...p, styleIds: ['s1'], ...(answers ? { styleAnswers: answers } : {}) }));
    await mkdir(join(dir, 'comp', 'assets'), { recursive: true });
    await writeFile(join(dir, 'comp', 'index.html'), '<div style="background:#3b7bff;color:#fff"></div><b style="color:#7c3aed"></b>');
    await writeFile(join(dir, 'comp', 'assets', 'x.svg'), '<svg fill="#ff0000"/>');
    return dir;
  }
  test('flags a colour outside the reference palette (assets/ ignored)', async () => {
    const r = await runPaletteCheck(await setup());
    expect(r.code).toBe(1);
    expect(r.offenders.map((o) => o.colour)).toEqual(['#7c3aed']);
  });
  test('the user accent is allowed', async () => {
    const r = await runPaletteCheck(await setup({ palette: 'reference', font: 'Inter', background: 'exact', accent: '#7c3aed' }));
    expect(r.code).toBe(0);
  });
});
