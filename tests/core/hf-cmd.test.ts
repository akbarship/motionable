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
  const req = (ok: boolean) => ['Node.js', 'FFmpeg', 'FFprobe', 'Chrome'].map((name) => ({ name, ok }));
  test('ignores optional checks when the required ones pass', () => {
    const r = { ok: false, checks: [...req(true), { name: 'whisper-cpp', ok: false }, { name: 'Docker running', ok: false }] };
    expect(doctorReportOk(JSON.stringify(r), true)).toBe(true);
    expect(doctorReportOk(JSON.stringify(r), false)).toBe(true);
  });
  test('fails when a required check fails', () => {
    const r = { ok: false, checks: [...req(true).slice(0, 3), { name: 'Chrome', ok: false }] };
    expect(doctorReportOk(JSON.stringify(r), true)).toBe(false);
  });
  test('fails when a required check is missing from a partial report', () => {
    const r = { ok: true, checks: req(true).slice(0, 2) };
    expect(doctorReportOk(JSON.stringify(r), true)).toBe(false);
  });

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
