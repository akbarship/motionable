import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { decodePcm, findHits, findSilences, parseSilences } from '../../src/media/audio.js';

const dir = mkdtempSync(join(tmpdir(), 'motionable-audio-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 4 s: a 50 ms bright click at 1.0 s, a 300 ms 80 Hz thump at 2.0 s, silence elsewhere. */
function fixture(): string {
  const f = join(dir, 'hits.wav');
  const expr = 'if(between(t,1,1.05),0.8*sin(2*PI*5000*t),0)+if(between(t,2,2.3),0.8*sin(2*PI*80*t),0)';
  // Commas inside a lavfi expression must be escaped, or they split the filter chain.
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=${expr.replace(/,/g, '\\,')}:s=16000:d=4`, '-y', f]);
  return f;
}

describe('audio', () => {
  test('finds a click and an impact at the right times', async () => {
    const hits = findHits(await decodePcm(fixture()));
    expect(hits).toHaveLength(2);
    expect(hits[0].t).toBeCloseTo(1, 1);
    expect(hits[0].kind).toBe('click');
    expect(hits[1].t).toBeCloseTo(2, 1);
    expect(hits[1].kind).toBe('impact');
  });

  test('silences between the sounds', async () => {
    const r = await findSilences(fixture(), -35, 0.25);
    expect(r.duration).toBeCloseTo(4, 1);
    expect(r.silences.length).toBe(3);
    expect(r.silences[0].start).toBe(0);
    expect(r.silences[1].start).toBeCloseTo(1.05, 1);
    expect(r.silences[2].end).toBeCloseTo(4, 1);
  });

  test('parses an open silence at the end', () => {
    const r = parseSilences('  Duration: 00:00:05.00, start\n[silencedetect] silence_start: 3.2\n');
    expect(r).toEqual({ duration: 5, silences: [{ start: 3.2, end: 5 }] });
  });
});
