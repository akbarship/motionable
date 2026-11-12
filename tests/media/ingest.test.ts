import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { RefDownloadError, RefUrlError, downloadRef, normalizeRefUrl } from '../../src/media/ingest.js';

describe('normalizeRefUrl', () => {
  test('rejects non-http', () => {
    expect(() => normalizeRefUrl('file:///etc/passwd')).toThrow(RefUrlError);
    expect(() => normalizeRefUrl('not a url')).toThrow(RefUrlError);
  });
  test('strips igsh', () => {
    expect(normalizeRefUrl('https://www.instagram.com/reel/ABC/?igsh=xyz#x')).toBe('https://www.instagram.com/reel/ABC/');
  });
  test('keeps other urls', () => {
    expect(normalizeRefUrl('https://example.com/v?a=1')).toBe('https://example.com/v?a=1');
  });
});

describe('downloadRef', () => {
  let tmp: string;
  let prevHome: string | undefined;
  let prevPath: string | undefined;
  beforeEach(async () => {
    prevHome = process.env.MOTIONABLE_HOME;
    prevPath = process.env.PATH;
    tmp = await mkdtemp(join(tmpdir(), 'motionable-'));
    process.env.MOTIONABLE_HOME = tmp;
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.MOTIONABLE_HOME;
    else process.env.MOTIONABLE_HOME = prevHome;
    process.env.PATH = prevPath;
    await rm(tmp, { recursive: true, force: true });
  });
  async function fake(body: string) {
    const bin = join(tmp, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'yt-dlp'), body);
    await chmod(join(bin, 'yt-dlp'), 0o755);
    process.env.PATH = `${bin}:${prevPath}`;
  }
  const ok = `#!/bin/sh
while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then T="$2"; fi; shift; done
F=$(echo "$T" | sed 's/%(id)s/abc/; s/%(ext)s/mp4/')
echo tiny > "$F"
echo "$F"
`;
  test('returns printed path', async () => {
    await fake(ok);
    const p = await downloadRef('proj', 'https://example.com/v');
    expect(p).toBe(join(tmp, 'projects', 'proj', 'refs', 'abc.mp4'));
    expect((await readFile(p, 'utf8')).trim()).toBe('tiny');
  });
  test('non-zero exit', async () => {
    await fake('#!/bin/sh\nexit 1\n');
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow(new RefDownloadError('Faylni yuklang'));
  });
  test('missing binary', async () => {
    process.env.PATH = join(tmp, 'nothing');
    delete process.env.MOTIONABLE_YTDLP;
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow('Faylni yuklang');
  });
});
