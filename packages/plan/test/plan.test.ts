// Anchors, the Uzbek text helper, validation and operations, on the imported IMG_4765 plan.
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {graphemes, applyBatch, buildTimeline, parseAnchor, resolveAnchor, validatePlan, wordsOf, type Batch, type EditPlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

const home = makeHome();
const job = loadJob(path.join(home, 'projects/sample-1'), home);
const plan = job.plan;
const ctx = job.ctx;
const batch = (ops: Batch['ops'], kind: Batch['by']['kind'] = 'editor'): Batch => ({base: plan.version, by: {kind}, ops});
const apply = (ops: Batch['ops'], p: EditPlan = plan) => applyBatch(p, {...batch(ops), base: p.version}, ctx);

describe('anchors', () => {
  it('parses every form', () => {
    expect(parseAnchor('word:89')).toMatchObject({base: 'word', n: 89, end: false, offset: 0});
    expect(parseAnchor('word:13.end+0.2')).toMatchObject({base: 'word', n: 13, end: true, offset: 0.2, offsetUnit: 's'});
    expect(parseAnchor('shot:s9-0.1')).toMatchObject({base: 'shot', id: 's9', end: false, offset: -0.1});
    expect(parseAnchor('shot:s1.end')).toMatchObject({base: 'shot', id: 's1', end: true});
    expect(parseAnchor('word:89+2f')).toMatchObject({offset: 2, offsetUnit: 'f'});
    expect(parseAnchor('end-4')).toMatchObject({base: 'end', offset: -4});
    expect(() => parseAnchor('word:x')).toThrow();
  });

  it('snaps a time inside a trimmed pause to the next kept frame', () => {
    const map = buildTimeline(plan.timeline.segments, 30);
    const words = wordsOf(plan, ctx.transcript);
    const g1 = map.segments[1];
    // 3.80 s is inside the pause trimmed between segments 0 and 1
    expect(resolveAnchor('t:3.80', {map, words, anchorLead: 0})).toBe(g1.start);
    expect(resolveAnchor('cut:1', {map, words, anchorLead: 0})).toBe(g1.start);
    expect(resolveAnchor('end-1', {map, words, anchorLead: 0})).toBe(map.totalFrames - 30);
  });
});

describe('graphemes', () => {
  it("keeps oʻ, gʻ and ʼ with their letter", () => {
    expect(graphemes('Oʻzbekiston')).toEqual(['Oʻ', 'z', 'b', 'e', 'k', 'i', 's', 't', 'o', 'n']);
    expect(graphemes('gʻildirak')[0]).toBe('gʻ');
    expect(graphemes('maʼlumot')).toEqual(['m', 'aʼ', 'l', 'u', 'm', 'o', 't']);
  });
});

describe('validation', () => {
  it('accepts the imported plan; its only warning is the retired title behind the speaker', () => {
    const r = validatePlan({...ctx, plan});
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.rule)).toEqual(['behind-subject']);
  });

  it('rejects a kept word that no caption line shows', () => {
    const p = structuredClone(plan);
    p.captions.lines = p.captions.lines.filter((l) => l.id !== 'l5');
    const r = validatePlan({...ctx, plan: p});
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === 'captions' && e.message.includes('in no caption line'))).toBe(true);
  });

  it('rejects unknown components and bad props', () => {
    const p = structuredClone(plan);
    p.captions.component = 'nope-captions@1';
    p.transitions[0].props = {strength: 9};
    const r = validatePlan({...ctx, plan: p});
    expect(r.errors.map((e) => e.rule)).toEqual(expect.arrayContaining(['components', 'props']));
  });

  it('warns when a hero is cut too soon', () => {
    // move the b-roll cut s4 one word earlier, onto the word right after the hero "ikki oy" (style never-do)
    const p = structuredClone(plan);
    p.shots.find((s) => s.id === 's4')!.from = 'word:14';
    const r = validatePlan({...ctx, plan: p});
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.rule === 'hero-hold')).toBe(true);
  });
});

describe('operations', () => {
  it('corrects a word, and "change all" corrects every match', () => {
    const words = wordsOf(plan, ctx.transcript);
    const same = words.filter((w) => w.text === words[9].text).map((w) => w.i); // "borib"
    expect(same.length).toBeGreaterThan(1);
    const r = apply([{op: 'word.setText', word: 9, text: 'borib!', scope: 'same'}]);
    expect(r.plan.version).toBe(plan.version + 1);
    for (const i of same) expect(r.plan.transcript.edits[String(i)]).toBe('borib!');
  });

  it('is all-or-nothing', () => {
    expect(() => apply([{op: 'caption.setRole', line: 'l1', role: 'hero'}, {op: 'shot.remove', id: 'nope'}])).toThrow(/op 1/);
  });

  it('cuts a retake and restores it', () => {
    const before = validatePlan({...ctx, plan}).resolved!.totalFrames;
    const cut = apply([{op: 'range.cut', from: 'word:20', to: 'word:21.end', kind: 'retake', evidence: ['repeat', 'gemini'], why: 'test'}]);
    const words = cut.plan.captions.lines.flatMap((l) => l.words);
    expect(words).not.toContain(20);
    expect(words).not.toContain(21);
    expect(cut.plan.timeline.removed).toHaveLength(1);
    const after = validatePlan({...ctx, plan: cut.plan}).resolved!.totalFrames;
    expect(after).toBeLessThan(before);
    const back = apply([{op: 'range.restore', from: 'word:20', to: 'word:21.end'}], cut.plan);
    expect(back.plan.captions.lines.flatMap((l) => l.words)).toEqual(expect.arrayContaining([20, 21]));
    expect(validatePlan({...ctx, plan: back.plan}).resolved!.totalFrames).toBe(before);
  });

  it('keeps a trimmed pause and trims it again', () => {
    const n = plan.timeline.segments.length;
    const kept = apply([{op: 'pause.keep', afterWord: 7}]);
    expect(kept.plan.timeline.segments).toHaveLength(n - 1);
    const trimmed = apply([{op: 'pause.trim', afterWord: 7}], kept.plan);
    expect(trimmed.plan.timeline.segments).toHaveLength(n);
  });

  it('splits and merges caption lines', () => {
    const l = plan.captions.lines.find((x) => x.words.length >= 3)!;
    const split = apply([{op: 'caption.split', line: l.id, atWord: l.words[1], id: 'split1'}]);
    const ids = split.plan.captions.lines.map((x) => x.id);
    expect(ids.indexOf('split1')).toBe(ids.indexOf(l.id) + 1);
    const merged = apply([{op: 'caption.merge', lines: [l.id, 'split1']}], split.plan);
    expect(merged.plan.captions.lines.find((x) => x.id === l.id)!.words).toEqual(l.words);
  });

  it('switches the caption style per video, shot and line', () => {
    const r = apply([
      {op: 'caption.setComponent', scope: 'video', component: 'bounce-captions@1'},
      {op: 'caption.setComponent', scope: 'shot', target: 's3', component: 'punch-captions@1', props: {size: 110}},
      {op: 'caption.setComponent', scope: 'line', target: 'l1', component: 'highlight-captions@1'},
    ]);
    const res = validatePlan({...ctx, plan: r.plan}).resolved!;
    expect(res.captionBlocks.some((b) => b.component === 'punch-captions@1' && b.shot === 's3' && b.props.size === 110)).toBe(true);
    expect(res.captionBlocks.find((b) => b.lines.some((x) => x.id === 'l1'))!.component).toBe('highlight-captions@1');
  });

  it('only lets the system import a whole plan', () => {
    expect(() => apply([{op: 'plan.import', plan}])).toThrow(/only the system/);
  });

  it('upgrades a component only within its name', () => {
    expect(() => apply([{op: 'component.upgrade', from: 'blur-zoom@1', to: 'set-hud@1'}])).toThrow(/keeps the component name/);
  });
});

describe('retake rule', () => {
  const w = (texts: string[]) => texts.map((text, i) => ({i, text, start: i * 0.4, end: i * 0.4 + 0.3}));
  it('is sure only when Gemini, the repeat and a complete kept take agree', async () => {
    const {judgeRetake} = await import('../src');
    const words = w(['unga', 'pul', 'berib,', 'pul', 'berib', 'kelganini']);
    const ok = judgeRetake({drop: [3, 4], keep: [0, 2], kind: 'repeat', confidence: 0.9, why: ''}, words);
    expect(ok.sure).toBe(true);
    expect(judgeRetake({drop: [3, 4], keep: [0, 2], kind: 'repeat', confidence: 0.7, why: ''}, words).sure).toBe(false);
    // the kept take doesn't end on punctuation
    expect(judgeRetake({drop: [0, 1], keep: [3, 4], kind: 'repeat', confidence: 0.9, why: ''}, words).checks.complete).toBe(false);
    // the words aren't a repeat
    expect(judgeRetake({drop: [5, 5], keep: [0, 2], kind: 'repeat', confidence: 0.95, why: ''}, words).checks.repeat).toBe(false);
  });
});
