// The preview page is written so an open player never reads half a file or a deleted clip.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {baseOf, pruneBases, writeIfChanged} from '../src/pagefiles';

describe('page files', () => {
  it('writes only a changed page, by rename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-page-'));
    const f = path.join(dir, 'index.html');
    expect(writeIfChanged(f, '<a>')).toBe(true);
    const ino = fs.statSync(f).ino;
    expect(writeIfChanged(f, '<a>')).toBe(false);
    expect(fs.statSync(f).ino).toBe(ino); // untouched
    expect(writeIfChanged(f, '<b>')).toBe(true);
    expect(fs.readFileSync(f, 'utf8')).toBe('<b>');
    expect(fs.readdirSync(dir)).toEqual(['index.html']); // no temp left behind
  });

  it('keeps the current base and the one the previous page played', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-assets-'));
    for (const f of ['base-aaa.mp4', 'base-bbb.mp4', 'base-ccc.mp4', 'other.mp4']) fs.writeFileSync(path.join(dir, f), '');
    expect(baseOf('<video src="assets/base-bbb.mp4">')).toBe('base-bbb.mp4');
    expect(pruneBases(dir, ['base-ccc.mp4', baseOf('<video src="assets/base-bbb.mp4">')])).toEqual(['base-aaa.mp4']);
    expect(fs.readdirSync(dir).sort()).toEqual(['base-bbb.mp4', 'base-ccc.mp4', 'other.mp4']);
  });
});
