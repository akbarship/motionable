import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PlanSchema, StyleSchema } from '../../src/core/types.js';

type Json = Record<string, any>;
const fixture = (): Json => JSON.parse(readFileSync(new URL('../fixtures/plan-v2.json', import.meta.url), 'utf8'));

/** Issues as "path: message" lines, empty when the plan is valid. */
function issues(plan: Json): string[] {
  const r = PlanSchema.safeParse(plan);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}
const expectIssue = (plan: Json, path: string, text: string) => {
  const found = issues(plan);
  expect(found.some((l) => l.startsWith(`${path}:`) && l.includes(text)), found.join('\n')).toBe(true);
};

describe('PlanSchema v2', () => {
  test('accepts the v2 fixture', () => {
    expect(issues(fixture())).toEqual([]);
  });

  test('requires story with hook, idea, payoff and cta', () => {
    const p = fixture();
    delete p.story;
    expect(issues(p).some((l) => l.startsWith('story'))).toBe(true);
    const q = fixture();
    q.story.hook = '';
    expect(issues(q).some((l) => l.startsWith('story.hook'))).toBe(true);
  });

  test('rejects voice tts', () => {
    const p = fixture();
    p.audio.voice = 'tts';
    expect(issues(p).some((l) => l.startsWith('audio.voice'))).toBe(true);
  });

  test('every scene needs at least one asset', () => {
    const p = fixture();
    p.scenes[0].assets = [];
    expectIssue(p, 'scenes.0.assets', 'at least one asset');
  });

  test('gen asset needs a prompt', () => {
    const p = fixture();
    delete p.scenes[1].assets[0].prompt;
    expectIssue(p, 'scenes.1.assets.0.prompt', "source 'gen' needs a prompt");
  });

  test('gen asset needs a fallback', () => {
    const p = fixture();
    p.scenes[1].assets[0].fallback = ' ';
    expectIssue(p, 'scenes.1.assets.0.fallback', 'fallback');
  });

  test('non-gen assets need no prompt or fallback', () => {
    const p = fixture();
    expect(p.scenes[0].assets[0].prompt).toBeUndefined();
    expect(issues(p)).toEqual([]);
  });

  test('refFrames must be project-relative', () => {
    const p = fixture();
    p.scenes[1].assets[0].refFrames = ['/home/x/sheet-1.jpg'];
    expectIssue(p, 'scenes.1.assets.0.refFrames.0', 'project-relative');
    p.scenes[1].assets[0].refFrames = ['../styles/a/sheet-1.jpg'];
    expectIssue(p, 'scenes.1.assets.0.refFrames.0', 'project-relative');
  });

  test('first scene starts at 0', () => {
    const p = fixture();
    p.scenes[0].start = 0.5;
    expectIssue(p, 'scenes.0.start', 'contiguous');
  });

  test('rejects a gap between scenes', () => {
    const p = fixture();
    p.scenes[1].start = 2.8;
    expectIssue(p, 'scenes.1.start', 'contiguous');
  });

  test('rejects an overlap between scenes', () => {
    const p = fixture();
    p.scenes[2].start = 5.5;
    expectIssue(p, 'scenes.2.start', 'contiguous');
  });

  test('last scene end must equal duration', () => {
    const p = fixture();
    p.duration = 10;
    expectIssue(p, 'duration', 'last scene end');
  });

  test('every scene is at least 0.8 s', () => {
    const p = fixture();
    p.scenes[0].end = 0.5;
    p.scenes[0].script = 'Salom';
    p.scenes[1].start = 0.5;
    expectIssue(p, 'scenes.0.end', '>= 0.8 s');
    const q = fixture();
    q.scenes[0].end = 0.8;
    q.scenes[0].script = 'Salom';
    q.scenes[1].start = 0.8;
    expect(issues(q)).toEqual([]);
  });

  test('script word rate is at most 3 words per second', () => {
    const p = fixture();
    p.scenes[0].script = 'bir ikki uch tort besh olti yetti sakkiz'; // 8 words in 2.5 s = 3.2/s
    expectIssue(p, 'scenes.0.script', 'words/s');
    p.scenes[0].script = 'bir ikki uch tort besh olti yetti'; // 7 words = 2.8/s
    expect(issues(p)).toEqual([]);
  });

  test('scenes may repeat a layout and a grammar (one frame for the whole video)', () => {
    const p = fixture();
    p.scenes[1].layout = p.scenes[0].layout;
    p.scenes.forEach((s: Json) => (s.grammar = 'tip card'));
    expect(issues(p)).toEqual([]);
  });

  test('grammar: all scenes or none', () => {
    const p = fixture();
    p.scenes[0].grammar = 'icon carousel';
    expectIssue(p, 'scenes.1.grammar', 'every scene needs a grammar');
  });

  test('message: at most 5 words, taken from the scene script', () => {
    const p = fixture();
    p.scenes[0].script = 'Ikkinchisi, plan mode. Shift+Tab bosasiz, 5 ta qadam.';
    p.scenes[0].end = 4;
    p.scenes[1].start = 4;
    p.scenes[0].message = 'Plan mode: shift+tab';
    expect(issues(p)).toEqual([]);
    p.scenes[0].message = '5 qadam'; // a digit may stand for a spoken number
    expect(issues(p)).toEqual([]);
    p.scenes[0].message = 'avval reja keyin kod';
    expectIssue(p, 'scenes.0.message', 'not in this scene');
    p.scenes[0].message = 'plan mode shift tab bosasiz ta qadam';
    expectIssue(p, 'scenes.0.message', 'at most 5');
  });

  test('message ignores apostrophe variants', () => {
    const p = fixture();
    p.scenes[0].script = 'Claude uni oʻzi oʻqiydi';
    p.scenes[0].message = "o'zi o'qiydi";
    expect(issues(p)).toEqual([]);
  });

  test('at most 3 things on screen; captions and transitions are not counted', () => {
    const p = fixture();
    const c = (kind: string) => ({ kind, description: 'x', props: {} });
    p.scenes[0].components = [c('title'), c('card'), c('overlay'), c('caption'), c('transition')];
    expect(issues(p)).toEqual([]);
    p.scenes[0].components.push(c('chart'));
    expectIssue(p, 'scenes.0.components', '4 elements on screen');
  });

  test('audio voice may be a separate voiceover', () => {
    const p = fixture();
    p.audio.voice = 'vo';
    expect(issues(p)).toEqual([]);
  });

  test('logo and ui are asset sources', () => {
    const p = fixture();
    p.scenes[0].assets.push({ id: 'lg', source: 'logo', what: 'GitHub mark' }, { id: 'ui1', source: 'ui', what: 'Claude Code prompt' });
    expect(issues(p)).toEqual([]);
  });

  test('scene count stays within +-1 of beats, beats 0 skips the check', () => {
    const p = fixture();
    p.beats = 5;
    expectIssue(p, 'scenes', 'beats is 5');
    p.beats = 4;
    expect(issues(p)).toEqual([]);
    p.beats = 2;
    expect(issues(p)).toEqual([]);
    p.beats = 0;
    expect(issues(p)).toEqual([]);
  });

  test('asset ids are unique across the plan', () => {
    const p = fixture();
    p.scenes[2].assets[0].id = 'a1';
    expectIssue(p, 'scenes.2.assets.0.id', 'used twice');
  });

  test('scene-level gen is gone: gen lives on assets', () => {
    const p = fixture();
    expect(PlanSchema.parse(p).scenes[1]).not.toHaveProperty('gen');
  });
});

describe('StyleSchema exact-style fields', () => {
  const base = {
    pace: { avgShotSeconds: 2, cutsPerMin: 30 },
    framing: 'centred',
    captions: { fontFamily: 'Inter', weight: 700, case: 'sentence', position: 'centre', highlight: 'colour', wordsPerLine: 3 },
    textCards: { when: 'x', look: 'y' },
    transitions: ['cut'],
    colour: { palette: ['#0b1a3a'], grade: 'cool' },
    motion: [{ name: 'blur-in', timing: '0.4 s' }],
    audio: { musicEnergy: 'mid', sfx: 'whoosh' },
    doNot: [],
    sheets: ['sheets/sheet-1.jpg'],
  };
  test('old styles still validate', () => {
    expect(StyleSchema.safeParse(base).success).toBe(true);
  });
  test('recipes, background, materials, type, grammars, assetsNeeded', () => {
    const r = StyleSchema.safeParse({
      ...base,
      recipes: [{ name: 'blur-in text', element: 'headline words', trigger: 'on spoken word', duration: 0.45, ease: 'power3.out', from: { opacity: 0, filter: 'blur(14px)', y: 24 }, to: { opacity: 1, filter: 'blur(0px)', y: 0 }, stagger: 0.06 }],
      background: { kind: 'bokeh on gradient', stops: ['#0b1a3a', '#1e5bff'], blobs: [{ colour: '#3b7bff', x: 0.2, y: 0.3, r: 260, blur: 90, drift: '20px over 4 s' }] },
      materials: [{ name: 'glass card', blur: 24, border: '1px solid rgba(255,255,255,.18)', opacity: 0.12, radius: 28 }],
      type: { families: ['Inter'], sizes: [{ role: 'headline', px: 96 }] },
      grammars: ['icon carousel', 'glass stat card'],
      assetsNeeded: [{ what: 'GitHub logo', how: 'logo' }],
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(StyleSchema.safeParse({ ...base, recipes: [{ name: 'x' }] }).success).toBe(false);
  });
  test('composition and sfx', () => {
    const composition = { visualsPerScene: { min: 1, max: 5 }, genPerScene: { min: 0, max: 5 }, textDensity: 'low', cameraMoves: true, sceneRules: ['laptop scene: 5 stacked gen cards'] };
    const sfx = [{ on: 'card-in', sound: 'pop', volume: 0.35 }];
    expect(StyleSchema.safeParse({ ...base, composition, sfx }).success).toBe(true);
    expect(StyleSchema.safeParse({ ...base, composition: { ...composition, genPerScene: { min: 3, max: 1 } } }).success).toBe(false);
    expect(StyleSchema.safeParse({ ...base, sfx: [{ on: 'cut', sound: 'whoosh', volume: 2 }] }).success).toBe(false);
  });
});
