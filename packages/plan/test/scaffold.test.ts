// The scaffold picks the camera from the project: a voiceover has no footage to frame, so it is off.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {scaffold} from '../src/scaffold';
import {makeHome} from './home';

describe('scaffold', () => {
  it('tracks a face, and turns the camera off for a voiceover', () => {
    const home = makeHome();
    const dir = path.join(home, 'projects', 'sample-1');
    expect(scaffold(dir, 'test@1', home).plan.camera?.mode).toBe('track');
    const job = path.join(dir, 'job.json');
    fs.writeFileSync(job, JSON.stringify({...JSON.parse(fs.readFileSync(job, 'utf8')), brief: {about: 'x', mode: 'voiceover'}}));
    fs.rmSync(path.join(dir, 'plan'), {recursive: true, force: true});
    expect(scaffold(dir, 'test@1', home).plan.camera?.mode).toBe('off');
  });

  it("keeps the voice's pauses when the approved plan says so", () => {
    const home = makeHome();
    const dir = path.join(home, 'projects', 'sample-1');
    const trimmed = scaffold(dir, 'test@1', home).plan.timeline.segments.length;
    fs.rmSync(path.join(dir, 'plan'), {recursive: true, force: true});
    const kept = scaffold(dir, 'test@1', home, {keepPauses: true}).plan;
    expect(trimmed).toBeGreaterThan(1);
    expect(kept.timeline.segments).toHaveLength(1); // one span: nothing between the words is cut
    expect(kept.timeline.why).toMatch(/keeps the voice's pauses/);
  });
});
