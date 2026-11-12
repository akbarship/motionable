import { delimiter, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { binDir, prependBinDir } from '../../src/core/path-env.js';

describe('prependBinDir', () => {
  test('puts the dir first', () => {
    const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', '/bin'].join(delimiter) };
    prependBinDir('/x/bin', env);
    expect(env.PATH).toBe(['/x/bin', '/usr/bin', '/bin'].join(delimiter));
  });
  test('is idempotent', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    prependBinDir('/x/bin', env);
    prependBinDir('/x/bin', env);
    expect(env.PATH).toBe(['/x/bin', '/usr/bin'].join(delimiter));
  });
  test('works with empty PATH', () => {
    const env: NodeJS.ProcessEnv = {};
    prependBinDir('/x/bin', env);
    expect(env.PATH).toBe('/x/bin');
  });
  test('uses Path key when that is how the env spells it (Windows)', () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows' };
    prependBinDir('C:\\m\\bin', env);
    expect(env.Path).toBe(['C:\\m\\bin', 'C:\\Windows'].join(delimiter));
    expect(env.PATH).toBeUndefined();
  });
});

describe('binDir', () => {
  test('is ~/.motionable/bin under the given home', () => {
    expect(binDir('/h')).toBe(join('/h', '.motionable', 'bin'));
  });
});
