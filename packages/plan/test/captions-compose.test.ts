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
