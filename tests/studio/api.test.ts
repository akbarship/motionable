import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, getToken, resetTokenForTests, upload } from '../../studio/src/api.js';

type Call = { url: string; init: RequestInit };
let calls: Call[];
let store: Map<string, string>;

function memStorage() {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

function okFetch(body: unknown = [], status = 200) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}

const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

beforeEach(() => {
  calls = [];
  store = new Map();
  resetTokenForTests();
  vi.stubGlobal('location', { search: '?t=tok123', hash: '' });
  vi.stubGlobal('sessionStorage', memStorage());
  vi.stubGlobal('fetch', okFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('studio api client', () => {
  test('sends x-motionable-token on every call', async () => {
    await api.listProjects();
    await api.getConfig();
    await api.claude();
    await api.addTask('demo', 'direct', { styleIds: [] });
    expect(calls).toHaveLength(4);
    for (const c of calls) expect(header(c, 'x-motionable-token')).toBe('tok123');
  });

  test('reads the token from ?t= once and stores it in sessionStorage', async () => {
    await api.listProjects();
    expect(store.get('motionable.token')).toBe('tok123');
    vi.stubGlobal('location', { search: '?t=other', hash: '' });
    await api.listProjects();
    expect(header(calls[1], 'x-motionable-token')).toBe('tok123');
  });

  test('falls back to sessionStorage when the URL has no token', async () => {
    store.set('motionable.token', 'saved');
    vi.stubGlobal('location', { search: '', hash: '#/new' });
    expect(getToken()).toBe('saved');
  });

  test('still works when sessionStorage throws', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    });
    await api.listProjects();
    expect(header(calls[0], 'x-motionable-token')).toBe('tok123');
  });

  test('throws Error(body.error) on non-2xx', async () => {
    vi.stubGlobal('fetch', okFetch({ error: 'Faylni yuklang' }, 502));
    await expect(api.addRef('demo', 'https://instagram.com/reel/x')).rejects.toThrow('Faylni yuklang');
  });

  test('sends JSON bodies with content-type', async () => {
    await api.createProject({ name: 'A', brief: 'b' });
    expect(calls[0].init.method).toBe('POST');
    expect(header(calls[0], 'content-type')).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ name: 'A', brief: 'b' });
  });

  test('upload uses XHR with token, encoded filename and progress', async () => {
    const sent: { url?: string; headers: Record<string, string> } = { headers: {} };
    class FakeXhr {
      status = 200;
      responseText = JSON.stringify({ name: 'klip 1.mp4' });
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
      onload?: () => void;
      onerror?: () => void;
      open(_m: string, url: string) {
        sent.url = url;
      }
      setRequestHeader(k: string, v: string) {
        sent.headers[k.toLowerCase()] = v;
      }
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const seen: number[] = [];
    const file = { name: 'klip 1.mp4' } as File;
    const out = await upload('demo', 'broll', file, (p) => seen.push(p));
    expect(out).toEqual({ name: 'klip 1.mp4' });
    expect(sent.url).toBe('/api/projects/demo/upload?kind=broll');
    expect(sent.headers['x-motionable-token']).toBe('tok123');
    expect(sent.headers['x-filename']).toBe(encodeURIComponent('klip 1.mp4'));
    expect(seen).toContain(0.5);
  });
});
