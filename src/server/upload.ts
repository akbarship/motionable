import { createWriteStream } from 'node:fs';
import { rename, stat, unlink } from 'node:fs/promises';
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

/** Returns a safe plain filename or throws a 400. */
export function checkFilename(raw: string | undefined): string {
  if (!raw) throw new HttpError(400, 'x-filename header required');
  if (basename(raw) !== raw || raw.includes('..') || raw.includes('\\') || raw.includes('\0')) {
    throw new HttpError(400, 'bad filename');
  }
  if (!EXTS.has(extname(raw).toLowerCase())) throw new HttpError(400, 'file type not allowed');
  return raw;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; await exists(join(dir, candidate)); i++) candidate = `${stem}-${i}${ext}`;
  return candidate;
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
  const name = await freeName(dir, wanted);
  const final = join(dir, name);
  const part = `${final}.part`;

  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD) cb(new HttpError(413, 'file too large'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(part, { flags: 'wx' }));
    if (!req.complete) throw new Error('upload aborted');
    await rename(part, final);
  } catch (e) {
    await unlink(part).catch(() => {});
    throw e;
  }
  return { name };
}
