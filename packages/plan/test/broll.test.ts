// B-roll shots reach the page: a muted clip over the shot's span, trimmed to clipIn, inside the transition layer.
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {compose} from '@motionable/compose';
import {resolvePlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

describe('b-roll', () => {
  it('composes each b-roll shot as a clip of its own', () => {
    const home = makeHome();
    const job = loadJob(path.join(home, 'projects/sample-1'), home);
    const r = resolvePlan({plan: job.plan, ...job.ctx});
    const shots = r.shots.filter((s) => s.broll);
    expect(shots.length).toBeGreaterThan(0);
    const html = compose({plan: {...r, overlays: [], transitions: [], captionBlocks: []}, base: 'assets/base.mp4', manifests: job.ctx.components, scripts: {}});
    const s = shots[0];
    const tag = new RegExp(`<video id="br-${s.id}" class="clip broll" src="[^"]+" data-start="${+(s.start / r.canvas.fps).toFixed(4)}" data-duration="[\\d.]+" data-media-start="[\\d.]+" data-track-index="1" muted`);
    expect(html).toMatch(tag);
    expect(html.indexOf(`br-${s.id}`)).toBeGreaterThan(html.indexOf('id="fx"'));
    expect(html.match(/class="clip broll"/g)!.length).toBe(shots.length);
  });
});
