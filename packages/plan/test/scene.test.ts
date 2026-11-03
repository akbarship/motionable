// Motion shots reach the page: the scene is mounted over the shot's span, inside #fx and under the captions.
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {compose} from '@motionable/compose';
import {resolvePlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

describe('motion scenes', () => {
  it('composes a motion shot as a scene instance with its words in seconds', () => {
    const home = makeHome();
    const job = loadJob(path.join(home, 'projects/sample-1'), home);
    const r = resolvePlan({plan: job.plan, ...job.ctx});
    const s = r.shots[0];
    s.scene = {component: 'test-scene@1', props: {}, words: [{id: 0, text: 'Salom', start: 3, end: 9}]};
    const fps = r.canvas.fps;
    const html = compose({plan: {...r, overlays: [], transitions: [], captionBlocks: []}, base: 'assets/base.mp4', manifests: job.ctx.components,
      scripts: {'test-scene@1': 'assets/components/test-scene@1.js'}});
    const sec = (f: number) => +(f / fps).toFixed(4);
    expect(html).toMatch(new RegExp(`<div id="sc-${s.id}" class="clip mc mc-scene" data-start="${sec(s.start)}" data-duration="[\\d.]+" data-track-index="1" style="z-index:10">`));
    // inside #fx (transitions move it), before the captions layer
    const at = html.indexOf(`<div id="sc-${s.id}"`);
    expect(at).toBeGreaterThan(html.indexOf('id="fx"'));
    expect(at).toBeLessThan(html.indexOf('id="captions"'));
    expect(html).toContain(`"kind":"scene"`);
    expect(html).toContain(`"words":[{"text":"Salom","start":${sec(s.start + 3)},"end":${sec(s.start + 9)}}]`);
  });

  it('fails a scene without a component.js', () => {
    const home = makeHome();
    const job = loadJob(path.join(home, 'projects/sample-1'), home);
    const r = resolvePlan({plan: job.plan, ...job.ctx});
    r.shots[0].scene = {component: 'missing@1', props: {}, words: []};
    expect(() => compose({plan: {...r, overlays: [], transitions: [], captionBlocks: []}, base: 'b.mp4', manifests: job.ctx.components, scripts: {}}))
      .toThrow(/has no component\.js/);
  });
});
