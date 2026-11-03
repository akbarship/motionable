// Stock b-roll: both sources searched on the user's keys, the asked shape first; without a key the answer says how
// to get one or to ask the user. Network calls are stubbed.
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-broll-'));
process.env.MOTIONABLE_STATE = state;
let broll: typeof import('../src/broll');
beforeAll(async () => {
  broll = await import('../src/broll'); // after MOTIONABLE_STATE: the settings are read from there
});
afterEach(() => vi.unstubAllGlobals());

const keys = (k: Record<string, string>) => fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({keys: k}));
const answer = (body: unknown) => ({ok: true, status: 200, json: async () => body}) as Response;

describe('stock b-roll', () => {
  it('says what to do without a key', async () => {
    keys({});
    await expect(broll.searchBroll({query: 'castle at night'})).rejects.toThrow(/Pexels or Pixabay key.*ask the user/);
  });

  it('searches both sources, portrait clips first, with author and page', async () => {
    keys({pexels: 'px', pixabay: 'pb'});
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.startsWith('https://api.pexels.com')) {
        expect((init?.headers as Record<string, string>).Authorization).toBe('px');
        return answer({videos: [
          {id: 1, duration: 8, width: 1920, height: 1080, url: 'https://pexels.com/v/1', image: 'p1.jpg', user: {name: 'Ann'}, video_files: []},
          {id: 2, duration: 6, width: 1080, height: 1920, url: 'https://pexels.com/v/2', image: 'p2.jpg', user: {name: 'Bob'}, video_files: []},
        ]});
      }
      return answer({hits: [{id: 9, duration: 5, pageURL: 'https://pixabay.com/v/9', user: 'Cem',
        videos: {large: {url: 'l.mp4', width: 1080, height: 1920, thumbnail: 't.jpg'}, medium: {url: 'm.mp4', width: 720, height: 1280, thumbnail: 'tm.jpg'}}}]});
    }));
    const found = await broll.searchBroll({query: 'castle', orientation: 'portrait', n: 3});
    expect(calls.some((u) => u.includes('pixabay.com/api/videos/') && u.includes('key=pb') && u.includes('q=castle'))).toBe(true);
    expect(found.map((f) => f.pick)).toEqual(['pixabay:9', 'pexels:2', 'pexels:1']); // sources take turns; the landscape one last
    expect(found[0]).toMatchObject({source: 'pixabay', author: 'Cem', page: 'https://pixabay.com/v/9', w: 1080, h: 1920});
  });

  it('credits the stock clips an edit uses', () => {
    const lines = broll.credits({
      br_pexels_2: {meta: {source: 'pexels', author: 'Bob', page: 'https://pexels.com/v/2', licence: 'Pexels License'}},
      br_mine: {meta: {name: 'mine.mp4'}},
      br_unused: {meta: {source: 'pixabay', author: 'Cem', page: 'x', licence: 'y'}},
    }, new Set(['br_pexels_2', 'br_mine']));
    expect(lines).toEqual(['https://pexels.com/v/2 (Bob, Pexels, Pexels License)']);
  });
});
