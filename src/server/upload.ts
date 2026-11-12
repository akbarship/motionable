import { link, mkdir, open, stat, unlink, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { projectDir } from '../core/paths.js';

export const MAX_UPLOAD = 2 * 1024 ** 3;
const EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mp3', '.wav', '.m4a', '.png', '.jpg', '.jpeg', '.webp']);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Decodes a percent-encoded x-filename and returns a safe plain filename, or throws a 400. */
export function checkFilename(raw: string | undefined, encoded = true): string {
  if (!raw) throw new HttpError(400, 'x-filename header required');
  let name = raw;
  if (encoded) {
    try {
      name = decodeURIComponent(raw);
    } catch {
      throw new HttpError(400, 'malformed filename');
    }
  }
  if (!name || Buffer.byteLength(name) > 200) throw new HttpError(400, 'bad filename length');
  // eslint-disable-next-line no-control-regex
  if (/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, 'bad filename');
  if (basename(name) !== name || name.includes('..')) throw new HttpError(400, 'bad filename');
  const ext = extname(name);
  if (!EXTS.has(ext.toLowerCase())) throw new HttpError(400, 'file type not allowed');
  if (RESERVED.test(name.slice(0, name.length - ext.length).split('.')[0])) throw new HttpError(400, 'reserved filename');
  return name;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function suffixed(name: string, i: number): string {
  if (i === 0) return name;
  const ext = extname(name);
  return `${name.slice(0, name.length - ext.length)}-${i}${ext}`;
}

export async function handleUpload(
  req: IncomingMessage,
  projectId: string,
  kind: string | null,
): Promise<{ name: string }> {
  if (kind !== 'broll' && kind !== 'refs') throw new HttpError(400, 'kind must be broll or refs');
  const header = req.headers['x-filename'];
  const wanted = checkFilename(Array.isArray(header) ? header[0] : header);
  if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) throw new HttpError(413, 'file too large');

  const dir = join(projectDir(projectId), kind);
  await mkdir(dir, { recursive: true });

  // Claim a free name by creating its .part exclusively; we only ever delete a .part we created.
  let handle: FileHandle | null = null;
  let idx = 0;
  for (; !handle; idx++) {
    const cand = suffixed(wanted, idx);
    if (await exists(join(dir, cand))) continue;
    try {
      handle = await open(join(dir, `${cand}.part`), 'wx');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  const claimed = idx - 1;
  const part = join(dir, `${suffixed(wanted, claimed)}.part`);

  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD) cb(new HttpError(413, 'file too large'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(req, counter, handle.createWriteStream());
    if (!req.complete) throw new Error('upload aborted');
    // Publish without clobbering: link fails with EEXIST if the final name appeared meanwhile.
    for (let i = claimed; ; i++) {
      const name = suffixed(wanted, i);
      try {
        await link(part, join(dir, name));
        await unlink(part);
        return { name };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  } catch (e) {
    await unlink(part).catch(() => {});
    throw e;
  }
}
