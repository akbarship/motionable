// The three camera modes: track (follow the face), fixed (one still crop), off (whole frame, no crop).
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {applyBatch, resolvePlan, type Batch, type EditPlan} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

const home = makeHome();
const job = loadJob(path.join(home, 'projects/sample-1'), home);
const ops = (plan: EditPlan, list: Batch['ops']) => applyBatch(plan, {base: plan.version, by: {kind: 'editor'}, ops: list}, job.ctx).plan;
const camera = (plan: EditPlan, ctx = job.ctx) => resolvePlan({plan, ...ctx}).camera;
const shotRange = (plan: EditPlan, id: string) => {
  const r = resolvePlan({plan, ...job.ctx});
  const s = r.shots.find((x) => x.id === id)!;
  return r.camera.slice(s.start, s.end);
};

describe('camera modes', () => {
  it('tracks by default when there is a face track', () => {
    const cam = camera(job.plan);
    const lefts = new Set(cam.slice(0, 200).map((c) => Math.round(c[1])));
    expect(lefts.size).toBeGreaterThan(1); // the crop moves with the face
  });

  it('fixed: one still crop per shot, centred on the chosen point', () => {
    const plan = ops(job.plan, [{op: 'camera.set', mode: 'fixed', center: [0.5, 0.4]}]);
    const speaker = plan.shots.find((s) => s.kind === 'speaker')!;
    const cam = shotRange(plan, speaker.id);
    expect(new Set(cam.map((c) => c.join())).size).toBe(1);
  });

  it('off: the whole frame fits the canvas, centred', () => {
    const plan = ops(job.plan, [{op: 'camera.set', mode: 'off'}]);
    const {w, h} = job.ctx.track!;
    const contain = Math.min(plan.canvas.w / w, plan.canvas.h / h);
    for (const [scale, left, top] of camera(plan)) {
      expect(scale).toBeCloseTo(contain, 6);
      expect(left).toBeCloseTo((w - plan.canvas.w / contain) / 2, 6);
      expect(top).toBeCloseTo((h - plan.canvas.h / contain) / 2, 6);
    }
  });

  it('a shot can override the plan mode, and clear it again', () => {
    const speaker = job.plan.shots.find((s) => s.kind === 'speaker')!;
    const plan = ops(job.plan, [{op: 'camera.set', shot: speaker.id, mode: 'off'}]);
    expect(plan.shots.find((s) => s.id === speaker.id)!.camera).toBe('off');
    expect(shotRange(plan, speaker.id)[0][0]).toBeCloseTo(Math.min(plan.canvas.w / job.ctx.track!.w, plan.canvas.h / job.ctx.track!.h), 6);
    const back = ops(plan, [{op: 'camera.set', shot: speaker.id, mode: null}]);
    expect(back.shots.find((s) => s.id === speaker.id)!.camera).toBeUndefined();
  });

  it('without a face track: fixed works, track is refused', () => {
    const {track: _, ...inputs} = job.plan.inputs;
    const meta = {w: job.ctx.track!.w, h: job.ctx.track!.h};
    const ctx = {...job.ctx, track: null, asset: (ref: string) => ({...job.ctx.asset(ref), ...(ref === inputs.source ? {meta} : {})})};
    const plan: EditPlan = {...job.plan, inputs, camera: {mode: 'fixed'}};
    expect(camera(plan, ctx).length).toBeGreaterThan(0);
    expect(() => camera({...plan, camera: {mode: 'track'}}, ctx)).toThrow(/no face track/);
  });
});
