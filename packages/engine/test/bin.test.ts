// External programs are found the same way on every system: ffmpeg from the installer's folder before PATH, and a
// package's command as plain Node running its JS file (no .bin shell scripts, which Windows can't start).
import {afterEach, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {binDir, nodeBin, tool} from '../src/bin';

const EXE = process.platform === 'win32' ? '.exe' : '';
const saved = process.env.MOTIONABLE_STATE;
afterEach(() => {
  if (saved === undefined) delete process.env.MOTIONABLE_STATE;
  else process.env.MOTIONABLE_STATE = saved;
});

describe('bin', () => {
  it('prefers the installer copy of ffmpeg, else PATH', () => {
    process.env.MOTIONABLE_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-bin-'));
    expect(tool('ffmpeg')).toBe('ffmpeg');
    fs.mkdirSync(binDir(), {recursive: true});
    fs.writeFileSync(path.join(binDir(), 'ffmpeg' + EXE), '');
    expect(tool('ffmpeg')).toBe(path.join(binDir(), 'ffmpeg' + EXE));
    expect(tool('ffprobe')).toBe('ffprobe');
  });

  it("runs a package's command with this Node and its JS file", () => {
    const [node, args] = nodeBin('hyperframes', ['render']);
    expect(node).toBe(process.execPath);
    expect(args[0]).toMatch(/hyperframes[\\/]bin[\\/]hyperframes\.mjs$/);
    expect(fs.existsSync(args[0])).toBe(true);
    expect(args.slice(1)).toEqual(['render']);
    expect(nodeBin('tsx')[1][0]).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
  });
});
