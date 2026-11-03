// The face is the one safe area: a caption block whose zone covers the face moves off it; YuNet decoding.
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {decodeYunet} from '@motionable/engine';
import {applyBatch, resolvePlan, type ResolvedPlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

const home = makeHome();
const job = loadJob(path.join(home, 'projects/sample-1'), home);

/** The face box in canvas px at frame f, as resolve and the page runtime see it. */
const faceBox = (r: ResolvedPlan, f: number) => {
  const [s, , tp] = r.camera[f];
  const [, cy, , fh] = r.face[f];
  return {top: ((cy - fh / 2) * r.source.h - tp) * s, bottom: ((cy + fh / 2) * r.source.h - tp) * s, cy: (cy * r.source.h - tp) * s};
};

describe('captions keep off the face', () => {
  it('moves a block whose zone sits on the face below it, keeping the default 40 px clear', () => {
    const r0 = resolvePlan({plan: job.plan, ...job.ctx});
    const b0 = r0.captionBlocks.find((b) => r0.faceSeen[b.start] > 0.9 && r0.shots.find((s) => s.id === b.shot)!.kind === 'speaker')!;
    const {cy} = faceBox(r0, b0.start);
    const {plan} = applyBatch(job.plan, {base: job.plan.version, by: {kind: 'editor'},
      ops: [{op: 'shot.update', id: b0.shot, set: {captionZone: Math.round(cy)}}]}, job.ctx);
    const r = resolvePlan({plan, ...job.ctx});
    const b = r.captionBlocks.find((x) => x.id === b0.id)!;
    expect(b.moved?.from).toBe(Math.round(cy));
    const sizes = b.lines.map((l) => l.style.size).sort((x, y) => y - x);
    const half = ((sizes[0] + (sizes[1] ?? 0)) * 1.15) / 2;
    for (let f = b.start; f < b.start + b.until; f++) {
      if (r.faceSeen[f] < 0.5) continue;
      const box = faceBox(r, f);
      expect(b.y - half >= box.bottom + 40 - 1 || b.y + half <= box.top - 40 + 1).toBe(true);
    }
  });

  it('leaves blocks that are already clear of the face where the zone puts them', () => {
    const r = resolvePlan({plan: job.plan, ...job.ctx});
    const clear = r.captionBlocks.filter((b) => !b.moved);
    expect(clear.length).toBeGreaterThan(0);
    for (const b of clear) expect(b.y).toBe(r.shots.find((s) => s.id === b.shot)!.captionY);
  });
});

describe('YuNet decoding', () => {
  it('picks the most confident cell and turns its offsets into a box', () => {
    const cells = (s: number) => (640 / s) ** 2;
    const out: Record<string, {data: Float32Array}> = {};
    for (const s of [8, 16, 32]) {
      out[`cls_${s}`] = {data: new Float32Array(cells(s))};
      out[`obj_${s}`] = {data: new Float32Array(cells(s))};
      out[`bbox_${s}`] = {data: new Float32Array(cells(s) * 4)};
    }
    const i = 3 * 20 + 7; // stride 32: row 3, column 7
    out.cls_32.data[i] = 0.9;
    out.obj_32.data[i] = 0.9;
    out.bbox_32.data.set([0.5, 0.25, Math.log(2), Math.log(3)], i * 4);
    out.cls_8.data[5] = 0.5; // under the threshold once combined
    out.obj_8.data[5] = 0.5;
    const f = decodeYunet(out)!;
    expect(f).toMatchObject({cx: (7 + 0.5) * 32, cy: (3 + 0.25) * 32});
    expect(f.w).toBeCloseTo(64);
    expect(f.h).toBeCloseTo(96);
    expect(f.score).toBeCloseTo(0.9);
    out.cls_32.data[i] = 0;
    expect(decodeYunet(out)).toBeNull();
  });
});
