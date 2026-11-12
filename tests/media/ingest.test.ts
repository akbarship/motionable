import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { FORMAT_SELECTORS, RefDownloadError, RefUrlError, downloadRef, normalizeRefUrl, refErrorReason } from '../../src/media/ingest.js';

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
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow(RefDownloadError);
  });
  test('missing binary', async () => {
    process.env.PATH = join(tmp, 'nothing');
    delete process.env.MOTIONABLE_YTDLP;
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow('yt-dlp topilmadi');
  });
  test('rejects url starting with dash', async () => {
    await fake(ok);
    await expect(downloadRef('proj', '--exec=evil')).rejects.toThrow(RefDownloadError);
  });
  test('passes -- before url', async () => {
    await fake(`#!/bin/sh\nfor a in "$@"; do echo "$a" >> "${tmp}/args"; done\nexit 1\n`);
    await downloadRef('proj', 'https://example.com/v').catch(() => {});
    const args = (await readFile(join(tmp, 'args'), 'utf8')).trim().split('\n');
    expect(args.slice(-2)).toEqual(['--', 'https://example.com/v']);
    expect(args).toContain('--merge-output-format');
  });
  test('printed path outside refs is rejected', async () => {
    await fake('#!/bin/sh\necho /etc/passwd\n');
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow(RefDownloadError);
  });
  test('disallowed extension rejected', async () => {
    await fake(ok.replace('mp4', 'exe'));
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow(RefDownloadError);
  });
  test('fallback ignores old files', async () => {
    const refs = join(tmp, 'projects', 'proj', 'refs');
    await mkdir(refs, { recursive: true });
    await writeFile(join(refs, 'old.mp4'), 'x');
    await utimes(join(refs, 'old.mp4'), 1, 1);
    await fake('#!/bin/sh\necho /etc/passwd\n');
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow(RefDownloadError);
  });
  test('fallback picks new file', async () => {
    await fake(ok.replace('echo "$F"', 'echo /etc/passwd'));
    expect(await downloadRef('proj', 'https://example.com/v')).toBe(join(tmp, 'projects', 'proj', 'refs', 'abc.mp4'));
  });
  test('tries format selectors in order, each with --retries 3', async () => {
    await fake(`#!/bin/sh\necho "$2 $4" >> "${tmp}/fmts"\necho 'ERROR: Requested format is not available' >&2\nexit 1\n`);
    await downloadRef('proj', 'https://example.com/v').catch(() => {});
    const lines = (await readFile(join(tmp, 'fmts'), 'utf8')).trim().split('\n');
    expect(lines).toEqual(FORMAT_SELECTORS.map((f) => `${f} 3`));
  });
  test('falls back to the next selector after a DNS failure', async () => {
    await fake(`#!/bin/sh
if [ "$2" = "${FORMAT_SELECTORS[0]}" ]; then echo 'ERROR: [Errno -3] Temporary failure in name resolution' >&2; exit 1; fi
${ok.split('\n').slice(1).join('\n')}`);
    expect(await downloadRef('proj', 'https://example.com/v')).toBe(join(tmp, 'projects', 'proj', 'refs', 'abc.mp4'));
  });
  test('login error stops early with an Uzbek reason', async () => {
    await fake(`#!/bin/sh\necho x >> "${tmp}/n"\necho 'ERROR: [Instagram] A: Requested content is not available, rate-limit reached or login required' >&2\nexit 1\n`);
    await expect(downloadRef('proj', 'https://example.com/v')).rejects.toThrow('kirishni talab');
    expect((await readFile(join(tmp, 'n'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});

describe('refErrorReason', () => {
  test('maps stderr to a reason', () => {
    expect(refErrorReason('Temporary failure in name resolution')).toMatch(/tarmoq/);
    expect(refErrorReason('login required')).toMatch(/kirishni/);
    expect(refErrorReason('ERROR: This video is private')).toMatch(/yopiq/);
    expect(refErrorReason('weird')).toMatch(/yuklab bo'lmadi/);
  });
});
