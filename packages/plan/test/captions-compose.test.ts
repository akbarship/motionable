// A line with its own caption component splits the shot's captions into blocks; each block must end where the next
// one starts, or two blocks show at once.
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {compose} from '@motionable/compose';
import {applyBatch, resolvePlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

describe('caption blocks', () => {
  it('end where the next block of the shot starts', () => {
    const home = makeHome();
    const job = loadJob(path.join(home, 'projects/sample-1'), home);
    const line = job.plan.captions.lines[3];
    const {plan} = applyBatch(job.plan, {base: job.plan.version, by: {kind: 'editor'},
      ops: [{op: 'caption.setComponent', scope: 'line', target: line.id, component: job.plan.captions.component, props: {maxLines: 1}}]}, job.ctx);
    const r = resolvePlan({plan, ...job.ctx});
    const scripts = Object.fromEntries(Object.keys(job.ctx.components).map((ref) => [ref, `assets/${ref}.js`]));
    const html = compose({plan: {...r, overlays: [], transitions: []}, base: 'assets/base.mp4', manifests: job.ctx.components, scripts});
    const caps = [...html.matchAll(/<div id="cap-([^"]+)" class="clip mc mc-caption" data-start="([\d.]+)" data-duration="([\d.]+)"/g)]
      .map((m) => ({shot: r.captionBlocks.find((b) => `cap-${b.id}` === `cap-${m[1]}`)!.shot, start: +m[2], end: +m[2] + +m[3]}));
    expect(caps.length).toBeGreaterThan(2);
    let pairs = 0;
    for (let i = 1; i < caps.length; i++) {
      if (caps[i].shot !== caps[i - 1].shot) continue;
      pairs++;
      expect(caps[i - 1].end).toBeLessThanOrEqual(caps[i].start + 0.0001);
    }
    expect(pairs).toBeGreaterThan(0);
  });
});

describe('caption words', () => {
  it('carry a tone to the component, and a word set to "" is spoken but not shown', () => {
    const home = makeHome();
    const job = loadJob(path.join(home, 'projects/sample-1'), home);
    // a line that is on screen (not in a cut), with two words
    const shown = resolvePlan({plan: job.plan, ...job.ctx}).captionBlocks.flatMap((x) => x.lines).find((l) => l.words.length >= 2)!;
    const line = job.plan.captions.lines.find((l) => l.id === shown.id)!;
    const [a, b] = line.words;
    const {plan} = applyBatch(job.plan, {base: job.plan.version, by: {kind: 'editor'}, ops: [
      {op: 'caption.tone', line: line.id, word: a, tone: 'alert'},
      {op: 'word.setText', word: b, text: ''},
    ]}, job.ctx);
    expect(plan.captions.lines.find((l) => l.id === line.id)!.tones).toEqual([{word: a, tone: 'alert'}]);
    const r = resolvePlan({plan, ...job.ctx});
    const words = r.captionBlocks.flatMap((x) => x.lines).find((l) => l.id === line.id)!.words;
    expect(words.find((w) => w.id === a)?.tone).toBe('alert');
    expect(words.some((w) => w.id === b)).toBe(false);
    // a word outside the line, or an unknown tone, is refused; null takes the tone back
    expect(() => applyBatch(plan, {base: plan.version, by: {kind: 'editor'}, ops: [{op: 'caption.tone', line: line.id, word: 99999, tone: 'accent'}]}, job.ctx)).toThrow(/isn't in line/);
    expect(() => applyBatch(plan, {base: plan.version, by: {kind: 'editor'}, ops: [{op: 'caption.tone', line: line.id, word: a, tone: 'gold'}]}, job.ctx)).toThrow(/tone is/);
    const back = applyBatch(plan, {base: plan.version, by: {kind: 'editor'}, ops: [{op: 'caption.tone', line: line.id, word: a, tone: null}]}, job.ctx).plan;
    expect(back.captions.lines.find((l) => l.id === line.id)!.tones).toBeUndefined();
  });
});
