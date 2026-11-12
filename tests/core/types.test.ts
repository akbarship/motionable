import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PlanSchema } from '../../src/core/types.js';

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

  test('adjacent scenes cannot share a layout (case and spaces ignored)', () => {
    const p = fixture();
    p.scenes[1].layout = '  Presenter full frame centred,  caption on the centre line ';
    expectIssue(p, 'scenes.1.layout', 'same layout as scene s1');
    const q = fixture();
    q.scenes[2].layout = q.scenes[0].layout; // not neighbours: allowed
    expect(issues(q)).toEqual([]);
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
