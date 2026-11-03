// The wizard's brief: kept in job.json, checked, and given to Claude by get_project_state only when asked (once).
import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkBrief, createProject} from '../src/analyze';
import {projectState} from '../src/projects';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-brief-'));
const clip = (dir: string) => {
  const f = path.join(dir, 'talk.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=320x568:d=1:r=30', '-f', 'lavfi', '-i', 'sine=d=1',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
  return f;
};

describe('brief', () => {
  it('checks what the wizard sends', () => {
    expect(checkBrief(undefined)).toBeUndefined();
    expect(() => checkBrief({about: ' ', mode: 'edit'})).toThrow(/about/);
    expect(() => checkBrief({about: 'x', mode: 'film'})).toThrow(/mode/);
    expect(checkBrief({about: ' Kofe haqida ', mode: 'voiceover', script: '', style: 'kofe@2'})).toEqual({about: 'Kofe haqida', mode: 'voiceover', style: 'kofe@2'});
  });

  it('lands in job.json and in the state when asked', async () => {
    const home = tmp();
    const id = await createProject([clip(tmp())], {title: 'Kofe', brief: {about: 'Kofe haqida', script: 'Salom', mode: 'edit', style: 'kofe@1'}}, home);
    const job = JSON.parse(fs.readFileSync(path.join(home, 'projects', id, 'job.json'), 'utf8'));
    expect(job.brief).toEqual({about: 'Kofe haqida', script: 'Salom', mode: 'edit', style: 'kofe@1'});
    expect(projectState(id, 0, false, home, true).brief?.script).toBe('Salom');
    expect('brief' in projectState(id, 0, false, home)).toBe(false);
  }, 30000);
});
