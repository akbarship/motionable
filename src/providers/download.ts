import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ALLOWED_EXTS } from '../server/upload.js';
import { httpError } from './util.js';

export const MAX_DOWNLOAD = 500 * 1024 ** 2;
const MAX_REDIRECTS = 5;

const CT_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mp4': '.m4a',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function pickExt(contentType: string | null, url: URL): string {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const fromType = CT_EXT[ct];
  const fromUrl = extname(url.pathname).toLowerCase();
  const ext = fromType ?? (ALLOWED_EXTS.has(fromUrl) ? fromUrl : '');
  if (!ext || !ALLOWED_EXTS.has(ext)) throw new Error('download refused: file type not allowed');
  return ext;
}

/**
 * Download a result URL to `<outDir>/<taskId>.<ext>`. https only (allowInsecure is for local test mocks),
 * 500 MB cap, streamed to a .part file and renamed on success.
 */
export async function downloadResult(
  rawUrl: string,
  outDir: string,
  taskId: string = randomBytes(6).toString('hex'),
  o: { allowInsecure?: boolean } = {},
): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('invalid task id for download');
  const okProto = (u: URL) => u.protocol === 'https:' || (o.allowInsecure === true && u.protocol === 'http:');
  let url = new URL(rawUrl);
  if (!okProto(url)) throw new Error('download refused: https only');
  let res = await fetch(url.href, { redirect: 'manual' });
  for (let hops = 0; res.status >= 300 && res.status < 400; hops++) {
    const loc = res.headers.get('location');
    if (!loc || hops >= MAX_REDIRECTS) throw new Error('download refused: bad redirect');
    url = new URL(loc, url);
    if (!okProto(url)) throw new Error('download refused: https only');
    await res.body?.cancel().catch(() => {});
    res = await fetch(url.href, { redirect: 'manual' });
  }
  if (!res.ok || !res.body) throw httpError('download', res.status);
  const ext = pickExt(res.headers.get('content-type'), url);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw new Error('download refused: file too large');

  await mkdir(outDir, { recursive: true });
  const final = join(outDir, `${taskId}${ext}`);
  const part = `${final}.part`;
  const handle = await open(part, 'w');
  let size = 0;
  const cap = new Transform({
    transform(chunk, _e, cb) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD) cb(new Error('download refused: file too large'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as never), cap, handle.createWriteStream());
    await rename(part, final);
    return final;
  } catch (e) {
    await unlink(part).catch(() => {});
    throw e;
  }
}
