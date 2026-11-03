// Stock b-roll for styles whose references are full of it: Pexels and Pixabay, on the user's own free keys. A search
// returns a short list Claude picks from (with a preview frame to look at); a pick is downloaded into the project as
// an ordinary br_ file, carrying its source, author and page, so an export can credit it (credits.txt).
import {Readable} from 'node:stream';
import {readConfig} from './settings';
import {saveUpload, type FileEntry} from './files';

export type Orientation = 'portrait' | 'landscape' | 'square';
export type Found = {pick: string; source: 'pexels' | 'pixabay'; durationS: number; w: number; h: number; preview: string; author: string; page: string};
type Source = {name: 'pexels' | 'pixabay'; key: string};

const keys = (): Source[] => {
  const k = readConfig().keys ?? {};
  return [...(k.pexels ? [{name: 'pexels' as const, key: k.pexels}] : []), ...(k.pixabay ? [{name: 'pixabay' as const, key: k.pixabay}] : [])];
};

const getJson = async <T>(url: string, headers: Record<string, string> = {}): Promise<T> => {
  const r = await fetch(url, {headers});
  if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}${r.status === 401 || r.status === 403 ? ' (check the key in Settings)' : ''}`);
  return r.json() as Promise<T>;
};

const shape = (w: number, h: number): Orientation => (h > w * 1.1 ? 'portrait' : w > h * 1.1 ? 'landscape' : 'square');

// ---------- Pexels ----------
type PexelsFile = {link: string; width: number; height: number; file_type: string};
type PexelsVideo = {id: number; duration: number; width: number; height: number; url: string; image: string; user: {name: string}; video_files: PexelsFile[]};
const pexelsFound = (v: PexelsVideo): Found => ({pick: `pexels:${v.id}`, source: 'pexels', durationS: v.duration, w: v.width, h: v.height,
  preview: v.image, author: v.user.name, page: v.url});

// ---------- Pixabay ----------
type PixabayFile = {url: string; width: number; height: number; thumbnail?: string};
type PixabayVideo = {id: number; duration: number; pageURL: string; user: string; videos: Record<'large' | 'medium' | 'small' | 'tiny', PixabayFile>};
const pixabayFound = (v: PixabayVideo): Found => {
  const big = v.videos.large?.url ? v.videos.large : v.videos.medium;
  return {pick: `pixabay:${v.id}`, source: 'pixabay', durationS: v.duration, w: big.width, h: big.height,
    preview: big.thumbnail ?? v.videos.medium.thumbnail ?? '', author: v.user, page: v.pageURL};
};

/** Search every source the user has a key for; the clips in the asked orientation first, longest last. */
export const searchBroll = async ({query, orientation = 'portrait', n = 6}: {query: string; orientation?: Orientation; n?: number}) => {
  const sources = keys();
  if (!sources.length) throw new Error('no stock key: add a free Pexels or Pixabay key in Studio ⚙ Settings, or ask the user to upload the clips');
  const per = Math.min(15, Math.max(3, n));
  const lists = await Promise.all(sources.map(async (s): Promise<Found[]> => {
    if (s.name === 'pexels') {
      const j = await getJson<{videos: PexelsVideo[]}>(
        `https://api.pexels.com/videos/search?${new URLSearchParams({query, orientation, per_page: String(per)})}`, {Authorization: s.key});
      return j.videos.map(pexelsFound);
    }
    const j = await getJson<{hits: PixabayVideo[]}>(`https://pixabay.com/api/videos/?${new URLSearchParams({key: s.key, q: query, per_page: String(per), safesearch: 'true'})}`);
    return j.hits.map(pixabayFound);
  }));
  // interleave the sources, the right shape first
  const all = lists.flatMap((l, i) => l.map((f, k) => ({f, rank: k * sources.length + i})));
  all.sort((a, b) => Number(shape(b.f.w, b.f.h) === orientation) - Number(shape(a.f.w, a.f.h) === orientation) || a.rank - b.rank);
  return all.slice(0, n).map((x) => x.f);
};

/** The file to download: the smallest one at least 1080 px on its short side (else the biggest there is). */
const bestOf = <T>(files: T[], w: (f: T) => number, h: (f: T) => number) => {
  const sorted = [...files].sort((a, b) => w(a) * h(a) - w(b) * h(b));
  return sorted.find((f) => Math.min(w(f), h(f)) >= 1080) ?? sorted.at(-1);
};

/** Download a pick into the project as a b-roll file, with where it came from. */
export const addBroll = async (project: string, pick: string): Promise<FileEntry & {source: string; author: string}> => {
  const [source, id] = pick.split(':');
  const s = keys().find((k) => k.name === source);
  if (!s || !/^\d+$/.test(id ?? '')) throw new Error(`unknown pick "${pick}" (from find_broll, like pexels:123)`);
  let url: string;
  let found: Found;
  if (s.name === 'pexels') {
    const v = await getJson<PexelsVideo>(`https://api.pexels.com/videos/videos/${id}`, {Authorization: s.key});
    const f = bestOf(v.video_files.filter((x) => x.file_type === 'video/mp4'), (x) => x.width, (x) => x.height);
    if (!f) throw new Error(`pexels ${id} has no MP4`);
    url = f.link;
    found = pexelsFound(v);
  } else {
    const j = await getJson<{hits: PixabayVideo[]}>(`https://pixabay.com/api/videos/?${new URLSearchParams({key: s.key, id})}`);
    const v = j.hits[0];
    if (!v) throw new Error(`pixabay ${id} not found`);
    const f = bestOf(Object.values(v.videos).filter((x) => x?.url), (x) => x.width, (x) => x.height)!;
    url = f.url;
    found = pixabayFound(v);
  }
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download failed (${r.status})`);
  const licence = s.name === 'pexels' ? 'Pexels License' : 'Pixabay Content License';
  const entry = await saveUpload(project, `${s.name}-${id}.mp4`, Readable.fromWeb(r.body as import('node:stream/web').ReadableStream),
    undefined, {source: s.name, author: found.author, page: found.page, licence});
  return {...entry, source: s.name, author: found.author};
};

/** The stock clips an edit uses, one line each, for credits.txt beside the export. */
export const credits = (assets: Record<string, {meta?: Record<string, unknown>}>, used: Set<string>) =>
  Object.entries(assets).filter(([k, a]) => used.has(k) && a.meta?.source).map(([, a]) =>
    `${a.meta!.page} (${a.meta!.author}, ${String(a.meta!.source).replace(/^./, (c) => c.toUpperCase())}, ${a.meta!.licence})`);
