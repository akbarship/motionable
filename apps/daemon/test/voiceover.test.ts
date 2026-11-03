// Voiceover motion: a voice track becomes a flat canvas-sized source.mp4 with that voice, the analysis skips the
// contact sheet and the face, and the scaffold turns the camera off.
import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {probe} from '@motionable/engine';
import {analyzeFree, createProject} from '../src/analyze';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-vo-'));

describe('voiceover', () => {
  it('makes a 1080×1920 source from 3 s of voice', async () => {
    const voice = path.join(tmp(), 'voice.m4a');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=220:d=3', '-c:a', 'aac', voice]);
    const home = tmp();
    await expect(createProject([voice], {brief: {about: 'x', mode: 'edit'}}, home)).rejects.toThrow(/not a video/);
    const id = await createProject([voice], {brief: {about: 'Kofe', mode: 'voiceover'}}, home);
    const dir = path.join(home, 'projects', id);
    const report = await analyzeFree(dir);
    const src = await probe(path.join(dir, 'input/source.mp4'));
    expect(src).toMatchObject({w: 1080, h: 1920, fps: 30, audio: true});
    expect(src.duration).toBeGreaterThan(2.9);
    expect(src.duration).toBeLessThan(3.2);
    expect(report.steps.sheet).toMatchObject({status: 'done', skipped: 'voiceover'});
    expect(report.steps.track).toMatchObject({noFace: true});
    expect(fs.existsSync(path.join(dir, 'analysis/contact.jpg'))).toBe(false);
    expect(report.warnings).toEqual([]);
  }, 60000);
});
