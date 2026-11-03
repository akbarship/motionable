// Sound on the page: effects at their frames, a music bed with fades, the closing fade on the footage.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {compose} from '@motionable/compose';
import {applyBatch, resolvePlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

describe('audio', () => {
  it('puts sfx and music on the page with volumes and fades, and fades the footage out', () => {
    const home = makeHome();
    const dir = path.join(home, 'projects/sample-1');
    const job0 = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
    fs.mkdirSync(path.join(dir, 'media/audio'), {recursive: true});
    for (const f of ['aud_whoosh.mp3', 'aud_bed.mp3']) fs.writeFileSync(path.join(dir, 'media/audio', f), '');
    job0.assets.aud_whoosh = {path: 'media/audio/aud_whoosh.mp3', kind: 'audio', meta: {duration: 0.8}};
    job0.assets.aud_bed = {path: 'media/audio/aud_bed.mp3', kind: 'audio', meta: {duration: 600}};
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(job0));
    const job = loadJob(dir, home);
    const {plan} = applyBatch(job.plan, {base: job.plan.version, by: {kind: 'mcp'}, ops: [
      {op: 'sfx.add', sfx: {id: 'w1', sound: 'asset:aud_whoosh', at: 'word:10', gain: -6}},
      {op: 'audio.set', set: {fadeOut: 1, music: {asset: 'asset:aud_bed', gain: -20}}},
    ]}, job.ctx);
    const r = resolvePlan({plan, ...job.ctx});
    expect(r.sfx[0]).toMatchObject({frames: 24, gain: -6});
    expect(r.audio).toMatchObject({fadeOut: 1, music: {start: 0, frames: r.totalFrames, gain: -20, fadeIn: 0.5, fadeOut: 1.5}});
    const html = compose({plan: {...r, overlays: [], transitions: [], captionBlocks: []}, base: 'assets/base.mp4', manifests: job.ctx.components, scripts: {}});
    expect(html).toMatch(/<video id="base"[^>]*data-fade-out="1"/);
    expect(html).toMatch(new RegExp(`<audio id="sfx-w1" class="clip" src="media/audio/aud_whoosh.mp3" data-start="${(r.sfx[0].frame / 30).toFixed(4).replace(/0+$/, '').replace(/\\.$/, '')}" data-duration="0.8" data-track-index="10" data-volume="0.501187"`));
    expect(html).toMatch(/<audio id="music" class="clip" src="media\/audio\/aud_bed.mp3" data-start="0" data-duration="[\d.]+" data-track-index="9" data-volume="0.1" data-fade-in="0.5" data-fade-out="1.5">/);
  });
});
