// The project's own files from the Studio: b-roll, images, audio and anything else the edit may need. Each one is
// copied into media/<kind>/ and listed in job.json as an asset Claude can use (asset:br_x as a b-roll shot's clip).
import fs from 'node:fs';
import path from 'node:path';
import type {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {EditPlan, JobManifest} from '@motionable/plan';
import {HOME, readJson, writeJson} from '@motionable/plan/store';
import {conformBroll, probe, probeMedia, thumbnail} from '@motionable/engine';
import {slug} from './analyze';
import {projectDir} from './projects';

const KINDS: {kind: string; prefix: string; ext: RegExp}[] = [
  {kind: 'broll', prefix: 'br', ext: /\.(mp4|mov|m4v|webm|mkv|avi)$/i},
  {kind: 'image', prefix: 'img', ext: /\.(png|jpe?g|webp|gif|svg)$/i},
  {kind: 'audio', prefix: 'aud', ext: /\.(mp3|wav|m4a|aac|ogg|flac)$/i},
  {kind: 'file', prefix: 'file', ext: /./},
];
const PREFIX = /^(br|img|aud|file)_/;
const MAX_BYTES = 2 * 1024 ** 3;
const reserved = new Set<string>(); // keys of uploads still running, so two at once never get the same one

export type FileEntry = {id: string; kind: string; name: string; bytes: number; durationS?: number; w?: number; h?: number; thumb?: string};

const manifestFile = (dir: string) => path.join(dir, 'job.json');

/** The project's files, newest last. `thumb` is a path under the project for the Studio to show. */
export const listFiles = (id: string, home = HOME): FileEntry[] => {
  const dir = projectDir(id, home);
  const m = readJson<JobManifest>(manifestFile(dir));
  return Object.entries(m.assets).filter(([k]) => PREFIX.test(k)).map(([k, a]) => {
    const meta = (a.meta ?? {}) as Record<string, unknown>;
    const file = path.join(dir, a.path);
    return {id: k, kind: a.kind, name: String(meta.name ?? path.basename(a.path)), bytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
      ...(typeof meta.duration === 'number' ? {durationS: +meta.duration.toFixed(2)} : {}),
      ...(typeof meta.w === 'number' ? {w: meta.w as number, h: meta.h as number} : {}),
      ...(typeof meta.thumb === 'string' ? {thumb: meta.thumb} : {})};
  });
};

/** Save one uploaded file under a fresh asset id (br_, img_, aud_ or file_ + the file's name). */
export const saveUpload = async (id: string, name: string, body: Readable, home = HOME): Promise<FileEntry> => {
  const dir = projectDir(id, home);
  const base = path.basename(name);
  const ext = path.extname(base).toLowerCase();
  const k = KINDS.find((x) => x.ext.test(base))!;
  const m = readJson<JobManifest>(manifestFile(dir));
  let key = `${k.prefix}_${slug(base).replace(/-/g, '_')}`;
  for (let n = 2; m.assets[key] || reserved.has(`${id}/${key}`); n++) key = `${k.prefix}_${slug(base).replace(/-/g, '_')}_${n}`;
  reserved.add(`${id}/${key}`);
  try {
    return await store(dir, id, key, k.kind, base, ext, body, home);
  } finally {
    reserved.delete(`${id}/${key}`);
  }
};

/** Stream the upload to disk, conform a video for the page, make a thumbnail, list it in job.json. */
const store = async (dir: string, id: string, key: string, kind: string, base: string, ext: string, body: Readable, home: string) => {
  const folder = path.join(dir, 'media', kind);
  fs.mkdirSync(folder, {recursive: true});
  const raw = path.join(folder, `${key}.upload${ext}`);
  let bytes = 0;
  body.on('data', (c: Buffer) => {
    bytes += c.length;
    if (bytes > MAX_BYTES) body.destroy(new Error('file is larger than 2 GB'));
  });
  try {
    await pipeline(body, fs.createWriteStream(raw));
  } catch (e) {
    fs.rmSync(raw, {force: true});
    throw e;
  }
  const meta: Record<string, unknown> = {name: base};
  let rel = path.relative(dir, raw);
  try {
    if (kind === 'broll') {
      const info = await probeMedia(raw);
      const planFile = path.join(dir, 'plan', 'edit-plan.json');
      const size = fs.existsSync(planFile) ? readJson<EditPlan>(planFile).canvas : {w: 1080, h: 1920};
      const out = path.join(folder, `${key}.mp4`);
      await conformBroll(raw, out, size);
      fs.rmSync(raw);
      rel = path.relative(dir, out);
      Object.assign(meta, {duration: info.duration, w: info.video.w, h: info.video.h, fps: info.video.fps});
    } else {
      const final = path.join(folder, `${key}${ext}`);
      fs.renameSync(raw, final);
      rel = path.relative(dir, final);
      if (kind === 'audio') meta.duration = (await probe(final).catch(() => null))?.duration; // probeMedia wants a video stream
    }
    if (kind === 'broll' || (kind === 'image' && ext !== '.svg')) {
      const thumb = path.join(dir, 'media', 'thumbs', `${key}.jpg`);
      fs.mkdirSync(path.dirname(thumb), {recursive: true});
      await thumbnail(path.join(dir, rel), thumb, kind === 'broll' ? Math.min(1, Number(meta.duration ?? 0) / 2) : 0).catch(() => {});
      if (fs.existsSync(thumb)) meta.thumb = path.relative(dir, thumb);
    }
  } catch (e) {
    fs.rmSync(raw, {force: true});
    throw new Error(`${base}: ${(e as Error).message.slice(-300)}`);
  }
  const fresh = readJson<JobManifest>(manifestFile(dir)); // re-read: another upload may have finished meanwhile
  fresh.assets[key] = {path: rel, kind, meta};
  writeJson(manifestFile(dir), fresh);
  return listFiles(id, home).find((f) => f.id === key)!;
};

/** Remove a file the plan doesn't use. */
export const deleteFile = (id: string, key: string, home = HOME) => {
  if (!PREFIX.test(key)) throw new Error(`${key} isn't a project file`);
  const dir = projectDir(id, home);
  const planFile = path.join(dir, 'plan', 'edit-plan.json');
  if (fs.existsSync(planFile) && new RegExp(`"asset:${key}(@\\d+)?"`).test(fs.readFileSync(planFile, 'utf8'))) {
    throw new Error(`${key} is used in the edit: take it out of the plan first`);
  }
  const m = readJson<JobManifest>(manifestFile(dir));
  const a = m.assets[key];
  if (!a) throw new Error(`no file ${key}`);
  for (const rel of [a.path, (a.meta as Record<string, unknown> | undefined)?.thumb]) if (typeof rel === 'string') fs.rmSync(path.join(dir, rel), {force: true});
  delete m.assets[key];
  writeJson(manifestFile(dir), m);
  return {removed: key};
};
