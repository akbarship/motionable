import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runAlign, runAssemble } from '../../src/cli.js';
import { createProject } from '../../src/core/store.js';
import { projectDir } from '../../src/core/paths.js';
import { remapWords, snapToSpeech, splitPauses } from '../../src/media/assemble.js';

let tmp: string;
const prev = process.env.MOTIONABLE_HOME;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'motionable-asm-'));
  process.env.MOTIONABLE_HOME = tmp;
});
afterEach(async () => {
  if (prev === undefined) delete process.env.MOTIONABLE_HOME;
  else process.env.MOTIONABLE_HOME = prev;
  await rm(tmp, { recursive: true, force: true });
});

const ffprobeDur = (f: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

/** 3 s of tone (speech stand-in) between silences: 0-1 silent, 1-2 tone, 2-3 silent. */
function clip(f: string, video: boolean) {
  const a = 'aevalsrc=if(between(t\\,1\\,2)\\,0.5*sin(2*PI*300*t)\\,0):s=48000:d=3';
  const args = ['-v', 'error', '-f', 'lavfi', '-i', a];
  if (video) args.push('-f', 'lavfi', '-i', 'testsrc=d=3:s=108x192:r=30', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  execFileSync('ffmpeg', [...args, '-y', f]);
}

describe('assemble', () => {
  test('snaps cut points next to speech, keeps points inside speech', () => {
    const sil = [{ start: 0, end: 1 }, { start: 2, end: 3 }];
    expect(snapToSpeech({ in: 0.2, out: 2.6 }, sil, 3)).toEqual({ in: 0.92, out: 2.08 });
    expect(snapToSpeech({ in: 1.5, out: 1.7 }, sil, 3)).toEqual({ in: 1.5, out: 1.7 });
    // STT word edges right at the speech get the breath too.
    expect(snapToSpeech({ in: 1.05, out: 1.98 }, sil, 3)).toEqual({ in: 0.92, out: 2.08 });
  });

  test('a long pause inside a take is cut down; short ones stay', () => {
    const sil = [{ start: 2, end: 3 }, { start: 4, end: 4.3 }];
    expect(splitPauses({ in: 1, out: 5, line: 'x' }, sil)).toEqual([
      { in: 1, out: 2.12, line: 'x' },
      { in: 2.88, out: 5 },
    ]);
  });

  test('remaps words onto the body timeline', () => {
    const w = [{ w: 'a', start: 1, end: 1.3 }, { w: 'b', start: 5, end: 5.2 }];
    expect(remapWords([{ in: 0.9, out: 1.5, words: w }, { in: 4.9, out: 5.3, words: w }])).toEqual([
      { w: 'a', start: 0.1, end: 0.4 },
      { w: 'b', start: 0.7, end: 0.9 },
    ]);
  });

  test('joins two voiceovers into one tight body.wav with words', async () => {
    const p = await createProject({ name: 'Cut', brief: 'Birinchi gap. Ikkinchi gap.' });
    const dir = projectDir(p.id);
    await mkdir(join(dir, 'broll'), { recursive: true });
    clip(join(dir, 'broll', 'a.wav'), false);
    clip(join(dir, 'broll', 'b.wav'), false);
    await writeFile(join(dir, 'broll', 'a.words.json'), JSON.stringify([{ w: 'birinchi', start: 1.1, end: 1.5 }, { w: 'gap', start: 1.55, end: 1.9 }]));
    await writeFile(join(dir, 'broll', 'b.words.json'), JSON.stringify([{ w: 'ikkinchi', start: 1.1, end: 1.5 }, { w: 'gap', start: 1.55, end: 1.9 }]));
    const al = await runAlign(dir, ['broll/a.wav', 'broll/b.wav']);
    expect(al.map((l) => l.pick?.src)).toEqual(['broll/a.wav', 'broll/b.wav']);
    await writeFile(
      join(dir, 'cut.json'),
      JSON.stringify({ segments: al.map((l) => ({ src: l.pick!.src, in: 0.3, out: 2.7, line: l.line })), dropped: [] }),
    );
    const r = await runAssemble(dir);
    expect(r.body).toBe('broll/body.wav');
    // Each 2.4 s segment snaps to ~1.16 s of speech + breath: the silences are gone.
    expect(r.duration).toBeGreaterThan(2.1);
    expect(r.duration).toBeLessThan(2.5);
    expect(ffprobeDur(join(dir, 'broll', 'body.wav'))).toBeCloseTo(r.duration, 1);
    const words = JSON.parse(await readFile(join(dir, 'broll', 'body.words.json'), 'utf8'));
    expect(words.map((w: { w: string }) => w.w)).toEqual(['birinchi', 'gap', 'ikkinchi', 'gap']);
    const cut = JSON.parse(await readFile(join(dir, 'cut.json'), 'utf8'));
    expect(cut.approved).toBe(false);
    expect(cut.segments[0].in).toBeCloseTo(0.92, 2);
  });

  test('video clips give body.mp4 in sync; mixing with audio-only is refused', async () => {
    const p = await createProject({ name: 'Vid', brief: 'x' });
    const dir = projectDir(p.id);
    await mkdir(join(dir, 'broll'), { recursive: true });
    clip(join(dir, 'broll', 'v1.mp4'), true);
    clip(join(dir, 'broll', 'v2.mp4'), true);
    clip(join(dir, 'broll', 'a.wav'), false);
    await writeFile(join(dir, 'cut.json'), JSON.stringify({ segments: [{ src: 'broll/v1.mp4', in: 0.5, out: 2.5 }, { src: 'broll/v2.mp4', in: 0.5, out: 2.5 }], dropped: [{ src: 'broll/v3.mp4', why: 'skriptda yo\'q' }] }));
    const r = await runAssemble(dir);
    expect(r.body).toBe('broll/body.mp4');
    expect(ffprobeDur(join(dir, 'broll', 'body.mp4'))).toBeCloseTo(r.duration, 1);
    await writeFile(join(dir, 'cut.json'), JSON.stringify({ segments: [{ src: 'broll/v1.mp4', in: 0.5, out: 2.5 }, { src: 'broll/a.wav', in: 0.5, out: 2.5 }], dropped: [] }));
    await expect(runAssemble(dir)).rejects.toThrow(/mix of video and audio-only/);
    await writeFile(join(dir, 'cut.json'), JSON.stringify({ segments: [{ src: '../../x.mp4', in: 0, out: 1 }], dropped: [] }));
    await expect(runAssemble(dir)).rejects.toThrow();
  });
});
