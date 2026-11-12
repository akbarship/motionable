import { delimiter, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { appendBinDir, binDir } from '../../src/core/path-env.js';

describe('appendBinDir', () => {
  test('puts the dir last so system tools win', () => {
    const env: NodeJS.ProcessEnv = { PATH: ['/usr/bin', '/bin'].join(delimiter) };
    appendBinDir('/x/bin', env);
    expect(env.PATH).toBe(['/usr/bin', '/bin', '/x/bin'].join(delimiter));
  });
  test('is idempotent and keeps an existing position', () => {
    const env: NodeJS.ProcessEnv = { PATH: ['/x/bin', '/usr/bin'].join(delimiter) };
    appendBinDir('/x/bin', env);
    expect(env.PATH).toBe(['/x/bin', '/usr/bin'].join(delimiter));
    const e2: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    appendBinDir('/x/bin', e2);
    appendBinDir('/x/bin', e2);
    expect(e2.PATH).toBe(['/usr/bin', '/x/bin'].join(delimiter));
  });
  test('works with empty PATH', () => {
    const env: NodeJS.ProcessEnv = {};
    appendBinDir('/x/bin', env);
    expect(env.PATH).toBe('/x/bin');
  });
  test('uses Path key when that is how the env spells it (Windows)', () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows' };
    appendBinDir('C:\\m\\bin', env);
    expect(env.Path).toBe(['C:\\Windows', 'C:\\m\\bin'].join(delimiter));
    expect(env.PATH).toBeUndefined();
  });
});

describe('binDir', () => {
  test('is ~/.motionable/bin under the given home', () => {
    expect(binDir('/h')).toBe(join('/h', '.motionable', 'bin'));
  });
});
