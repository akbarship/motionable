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
});
