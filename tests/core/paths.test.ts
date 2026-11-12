import { describe, expect, test } from 'vitest';
import { projectDir, styleDir } from '../../src/core/paths.js';

describe('paths id validation', () => {
  test.each(['..', '../x', 'a/b', 'A', '', 'a b', 'x\0y'])('rejects %j', (id) => {
    expect(() => projectDir(id)).toThrow();
    expect(() => styleDir(id)).toThrow();
  });
  test('accepts slug ids', () => {
    expect(projectDir('my-video-a1b2c3')).toMatch(/my-video-a1b2c3$/);
    expect(styleDir('k1')).toMatch(/k1$/);
  });
});
