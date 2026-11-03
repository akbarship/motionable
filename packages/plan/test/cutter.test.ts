// Cut candidates from the transcript: restarts and Uzbek fillers.
import {describe, expect, it} from 'vitest';
import {proposeCuts, type Word} from '../src';

const say = (text: string, gaps: Record<number, number> = {}): Word[] => {
  let t = 0;
  return text.split(' ').map((w, i) => {
    t += gaps[i] ?? 0;
    const word = {i, text: w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2), conf: 0.9};
    t += 0.35;
    return word;
  });
};

describe('cutter', () => {
  it('finds a restart and drops the first attempt', () => {
    const c = proposeCuts(say('Bugun men sizga bugun men sizga uchta xato haqida aytaman.'));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({kind: 'retake', from: 'word:0', to: 'word:2.end', sure: true});
  });

  it('catches a stutter', () => {
    const c = proposeCuts(say('Men men buni bilaman.'));
    expect(c[0]).toMatchObject({kind: 'retake', from: 'word:0', to: 'word:0.end', sure: true});
  });

  it('leaves real repetition across sentences alone', () => {
    expect(proposeCuts(say('Pul bor. Pul bor ekan, ish ham bor.'))).toEqual([]);
  });

  it('ignores a repeat that comes too late', () => {
    expect(proposeCuts(say('mijozlar kelmaydi mijozlar kelmaydi.', {2: 11}))).toEqual([]);
  });

  it('cuts filler sounds, only suggests markers, keeps held vowels', () => {
    const w = say('Ee bu xullas juda muhim haligi gap.');
    const c = proposeCuts(w);
    expect(c.map((x) => [x.text, x.sure])).toEqual([['Ee', true], ['xullas', false], ['haligi', true]]);
    w[0].end = w[0].start + 1.5; // a long "eee" is a word the speaker meant to hold
    expect(proposeCuts(w).some((x) => x.text === 'Ee')).toBe(false);
  });

  it('skips words that are already cut and keeps transcript indices', () => {
    const w = say('Ee bugun bugun gaplashamiz.');
    const c = proposeCuts(w, (t) => t >= 0.3); // word 0 is already cut
    expect(c).toEqual([expect.objectContaining({kind: 'retake', from: 'word:1', to: 'word:1.end'})]);
  });
});

describe('cutter: whole sentences said again', () => {
  it('drops earlier attempts of a sentence, keeps the last one', () => {
    const c = proposeCuts(say('Ikkinchi skill esa sizni oʻzingiz. Ikkinchi skill esa sizni oʻying. Ikkinchi skill esa sizni oʻrningizga ishlaydi.'));
    expect(c.map((x) => [x.from, x.to, x.sure])).toEqual([['word:0', 'word:4.end', true], ['word:5', 'word:9.end', true]]);
  });

  it('a one-word sentence that the next sentence opens with', () => {
    const c = proposeCuts(say('Toʻrtinchi. Toʻrtinchi skill bu Claude Shorts.'));
    expect(c[0]).toMatchObject({from: 'word:0', to: 'word:0.end', sure: true});
  });
});
