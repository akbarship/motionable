// The WebKitGTK media shim's decisions: where a clip should be, when to seek, how the seek latency is learned.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type Api = {expectedTime(t: number, s: number, d: number, m: number): number | null; nextLag(l: number, r: number): number;
  shouldSeek(drift: number, since: number | null, now: number, last: number): boolean; LAG0: number};
// the shim is a plain browser script: run it without a window and take the functions it publishes
new Function(fs.readFileSync(path.join(__dirname, '../static/webkit-media-shim.js'), 'utf8'))();
const api = (globalThis as unknown as {__mcMediaSync: Api}).__mcMediaSync;

describe('webkit media shim', () => {
  it('knows where a clip should be, and not outside its span', () => {
    expect(api.expectedTime(5, 0, 39.4, 0)).toBe(5);
    expect(api.expectedTime(21, 20, 4, 0.5)).toBeCloseTo(1.5);
    expect(api.expectedTime(19.9, 20, 4, 0)).toBeNull(); // before it starts
    expect(api.expectedTime(23.8, 20, 4, 0)).toBeNull(); // its last 0.3 s: leave the end alone
  });
  it('seeks only for a drift that lasted, not twice in a row', () => {
    expect(api.shouldSeek(0.05, 0, 1000, -Infinity)).toBe(false); // small
    expect(api.shouldSeek(0.36, 900, 1000, -Infinity)).toBe(false); // just started
    expect(api.shouldSeek(0.36, 400, 1000, -Infinity)).toBe(true);
    expect(api.shouldSeek(-0.3, 0, 1000, -Infinity)).toBe(true); // ahead counts too
    expect(api.shouldSeek(0.36, 0, 3000, 1500)).toBe(false); // a seek 1.5 s ago
    expect(api.shouldSeek(0.36, null, 3000, -Infinity)).toBe(false);
  });
  it('learns the seek latency from what is left after a seek, within 0–1 s', () => {
    expect(api.LAG0).toBe(0.35);
    expect(api.nextLag(0.35, 0.02)).toBeCloseTo(0.37);
    expect(api.nextLag(0.35, -0.1)).toBeCloseTo(0.25); // overshot: less next time
    expect(api.nextLag(0.9, 0.5)).toBe(1);
    expect(api.nextLag(0.1, -0.4)).toBe(0);
  });
});
