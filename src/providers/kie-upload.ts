import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertInHome } from '../core/paths.js';
import { httpError } from './util.js';

// kie.ai File Upload API (read 2026-11-12):
//  - https://docs.kie.ai/file-upload-api/quickstart and https://docs.kie.ai/file-upload-api/upload-file-stream
//  - POST https://kieai.redpandaai.co/api/file-stream-upload (docs list api.kie.ai as the server but the curl example uses
//    kieai.redpandaai.co; the quickstart names kieai.redpandaai.co as base host). Auth: Authorization: Bearer <key>.
//  - multipart/form-data: file (binary), uploadPath (required, no leading/trailing slash), fileName (optional).
//  - HTTP status is always 200: check body.code. Success: {success, code:200, msg, data:{fileName, filePath, downloadUrl, fileSize, mimeType, uploadedAt}}.
//  - data.downloadUrl (https://tempfile.redpandaai.co/...) is valid while the file exists: "Uploaded files are deleted 24 hours after upload."
//  - Stream upload has no stated size limit (base64 is advised <= 10 MB). Uploads are free.
export const UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
export const UPLOAD_PATH = 'motionable/refs';
const TTL_MS = 24 * 3_600_000;
/** Treat a URL as expired one hour early so a task never starts with a link about to die. */
const SAFETY_MS = 3_600_000;
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SHRINK_ABOVE = 2 * 1024 ** 2;
const MAX_SIDE = 2048;
const exec = promisify(execFile);

type CacheFile = Record<string, { url: string; expiresAt: number }>;

async function readCache(path: string): Promise<CacheFile> {
  try {
    const j = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as CacheFile) : {};
  } catch {
    return {};
  }
}

async function shrink(file: string, dir: string): Promise<string> {
  const out = join(dir, 'ref.jpg');
  await exec('ffmpeg', [
    '-y', '-v', 'error', '-i', file,
    '-vf', `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease`,
    '-frames:v', '1', '-q:v', '3', out,
  ]);
  return out;
}

export type UploadOpts = {
  /** Directory holding gen/ref-urls.json. Without it nothing is cached. */
  projectDir?: string;
  now?: () => number;
};

/**
 * Upload one local reference image to kie.ai's temp storage and return its public URL.
 * `file` must lie inside MOTIONABLE_HOME and be jpg/png/webp. Large images are shrunk (max 2048 px, jpg) first.
 * URLs are cached per content hash in <projectDir>/gen/ref-urls.json until ~24 h after upload.
 */
export async function uploadRef(key: string, file: string, o: UploadOpts = {}): Promise<string> {
  const abs = assertInHome(file);
  if (!EXTS.has(extname(abs).toLowerCase())) throw new Error(`reference image must be jpg, png or webp: ${basename(abs)}`);
  const now = o.now ?? Date.now;
  const bytes = await readFile(abs);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const cachePath = o.projectDir ? join(o.projectDir, 'gen', 'ref-urls.json') : undefined;
  if (cachePath) {
    const hit = (await readCache(cachePath))[hash];
    if (hit && typeof hit.url === 'string' && hit.expiresAt - SAFETY_MS > now()) return hit.url;
  }

  let tmp: string | undefined;
  try {
    let send = abs;
    let data: Buffer = bytes;
    let name = `${hash.slice(0, 16)}${extname(abs).toLowerCase()}`;
    if ((await stat(abs)).size > SHRINK_ABOVE) {
      tmp = await mkdtemp(join(tmpdir(), 'motionable-ref-'));
      send = await shrink(abs, tmp);
      data = await readFile(send);
      name = `${hash.slice(0, 16)}.jpg`;
    }
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(data)], { type: send.endsWith('.jpg') ? 'image/jpeg' : undefined }), name);
    form.set('uploadPath', UPLOAD_PATH);
    form.set('fileName', name);
    const res = await fetch(UPLOAD_URL, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
    if (!res.ok) throw httpError('kie.ai upload', res.status);
    const j = (await res.json()) as { code?: number; msg?: string; data?: { downloadUrl?: string } };
    if (j.code !== undefined && j.code !== 200) throw new Error(`kie.ai upload error ${j.code}: ${j.msg ?? ''}`.trim());
    const url = j.data?.downloadUrl;
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('kie.ai upload answered without a download url');
    if (cachePath) {
      const cache = await readCache(cachePath);
      cache[hash] = { url, expiresAt: now() + TTL_MS };
      await mkdir(join(o.projectDir!, 'gen'), { recursive: true });
      const part = `${cachePath}.${process.pid}.part`;
      await writeFile(part, JSON.stringify(cache));
      await rename(part, cachePath);
    }
    return url;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

/** Resolve project-relative ref frames (max 4) to files confined to the project dir and MOTIONABLE_HOME. */
export function resolveRefs(projectDir: string, refs: unknown): string[] {
  if (!Array.isArray(refs)) return [];
  const root = resolve(projectDir);
  return refs.slice(0, 4).map((r) => {
    if (typeof r !== 'string' || !r) throw new Error('refFrames must be project-relative paths');
    const abs = assertInHome(resolve(root, r));
    const rel = relative(root, abs);
    if (rel === '..' || rel.startsWith('..') || resolve(root, rel) !== abs) throw new Error(`reference outside project: ${r}`);
    return abs;
  });
}
