import {describe, expect, it} from 'vitest';
import {snap, timeToAnchor} from '../src/timeAnchor';

const words = [{i: 0, at: 0.1}, {i: 1, at: null}, {i: 2, at: 1.0}, {i: 3, at: 2.5}];

describe('timeToAnchor', () => {
  it('hangs a moment on the last kept word before it, the rest in frames', () => {
    expect(timeToAnchor(words, 1.0, 30)).toBe('word:2');
    expect(timeToAnchor(words, 1.5, 30)).toBe('word:2+15f');
    expect(timeToAnchor(words, 3.0, 30)).toBe('word:3+15f');
    expect(timeToAnchor(words, 0.05, 30)).toBe('word:0-1f'); // before the first word: a negative offset
  });
  it('skips cut words and snaps to frames', () => {
    expect(timeToAnchor(words, 0.6, 30)).toBe('word:0+15f'); // word 1 is cut
    expect(snap(1.016, 30, 10)).toBe(1);
    expect(snap(1.02, 30, 10)).toBeCloseTo(31 / 30, 6);
    expect(snap(-1, 30, 10)).toBe(0);
    expect(snap(12, 30, 10)).toBe(10);
  });
});
