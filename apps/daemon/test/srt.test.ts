// The export's SRT: one cue per visible caption line, in output time, never overlapping.
import {describe, expect, it} from 'vitest';
import {srtOf, studioView} from '../src/projects';
import {makeHome} from '../../../packages/plan/test/home';

describe('srt', () => {
  it('writes ordered, non-overlapping cues from the caption lines', () => {
    const home = makeHome();
    const srt = srtOf('sample-1', home);
    const cues = srt.trim().split('\n\n').map((c) => c.split('\n'));
    const v = studioView('sample-1', home);
    expect(cues.length).toBe(v.lines.filter((l) => !l.hidden && l.words.some((i) => v.words[i]?.out !== null)).length);
    const sec = (t: string) => {
      const [h, m, s] = t.replace(',', '.').split(':').map(Number);
      return h * 3600 + m * 60 + s;
    };
    let prev = 0;
    cues.forEach((c, i) => {
      expect(c[0]).toBe(String(i + 1));
      const [a, b] = c[1].split(' --> ').map(sec);
      expect(a).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(b).toBeGreaterThan(a);
      expect(c[2].length).toBeGreaterThan(0);
      prev = b;
    });
    expect(cues[0][1]).toMatch(/^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/);
  });
});
