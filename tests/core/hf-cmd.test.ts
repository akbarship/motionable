import { describe, expect, test } from 'vitest';
import { doctorReportOk, npxCommand } from '../../src/core/hf-cmd.js';

describe('npxCommand', () => {
  test('posix: plain npx, no shell', () => {
    expect(npxCommand('linux', ['hyperframes', 'doctor'])).toEqual({ cmd: 'npx', args: ['hyperframes', 'doctor'], shell: false });
    expect(npxCommand('darwin', ['x']).shell).toBe(false);
  });
  test('win32: npx.cmd through a shell (needed for .cmd shims), args untouched', () => {
    expect(npxCommand('win32', ['hyperframes', 'doctor', '--json'])).toEqual({
      cmd: 'npx.cmd',
      args: ['hyperframes', 'doctor', '--json'],
      shell: true,
    });
  });
});

describe('doctorReportOk', () => {
  test('gates on .ok', () => {
    expect(doctorReportOk('{"ok":true}', true)).toBe(true);
    expect(doctorReportOk('{"ok":false}', true)).toBe(false);
  });
  test('falls back to exit status when no usable .ok', () => {
    expect(doctorReportOk('not json', true)).toBe(true);
    expect(doctorReportOk('{"checks":[]}', true)).toBe(true);
    expect(doctorReportOk('', false)).toBe(false);
  });
});
