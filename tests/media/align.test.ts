import { describe, expect, test } from 'vitest';
import { alignScript, norm, scriptLines, wordSim } from '../../src/media/align.js';
import type { Words } from '../../src/core/types.js';

/** Words at 0.4 s per word, with an optional pause before chosen indexes. */
function speak(text: string, t0 = 0, pauses: Record<number, number> = {}): Words {
  let t = t0;
  return text.split(/\s+/).map((w, i) => {
    t += pauses[i] ?? 0;
    const x = { w, start: t, end: t + 0.35 };
    t += 0.4;
    return x;
  });
}

describe('align', () => {
  test('normalises Uzbek apostrophes and punctuation', () => {
    expect(norm("Oʻzi O‘QIYDI, g'oya!")).toBe("o'zi o'qiydi g'oya");
    expect(wordSim("o'qiydi", 'oqiydi')).toBeGreaterThan(0.8);
    expect(scriptLines('# Sarlavha\nBirinchisi, CLAUDE.md. Ilgari tushuntirardim.\n\nEndi yozaman!')).toEqual([
      'Sarlavha',
      'Birinchisi, CLAUDE.md.',
      'Ilgari tushuntirardim.',
      'Endi yozaman!',
    ]);
  });

  test('a slipped line said again: the later full take wins, the cut-off one is dropped', () => {
    const script = 'Claude uni har sessiyada o‘zi o‘qiydi. Kod faqat keyin yoziladi.';
    // "claude uni har sessa" (slip, stops) ... "claude uni har sessiyada o'zi o'qiydi" ... next line
    const words = speak("claude uni har sessa eee claude uni har sessiyada o'zi o'qiydi kod faqat keyin yoziladi");
    const [a, b] = alignScript(script, [{ src: 'vo.wav', words }]);
    expect(a.takes.length).toBe(2);
    expect(a.pick!.from).toBe(5);
    expect(a.pick!.coverage).toBe(1);
    expect(b.pick!.from).toBe(11);
  });

  test('lines come from several voiceovers', () => {
    const script = 'Birinchisi plan mode. Ikkinchisi Esc tugmasi.';
    const r = alignScript(script, [
      { src: 'a.wav', words: speak('birinchisi plan mode') },
      { src: 'b.wav', words: speak('xullas ikkinchisi esc tugmasi') },
    ]);
    expect(r[0].pick!.src).toBe('a.wav');
    expect(r[1].pick!.src).toBe('b.wav');
    expect(r[1].pick!.start).toBeCloseTo(0.4, 5);
  });

  test('a line never said has no pick', () => {
    const r = alignScript('Bu gap aytilmagan edi.', [{ src: 'a.wav', words: speak('boshqa narsa haqida gapirdim') }]);
    expect(r[0].pick).toBeNull();
  });
});
