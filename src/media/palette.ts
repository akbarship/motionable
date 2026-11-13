import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

type Rgb = [number, number, number];
type Lab = [number, number, number];

/** Colours written in CSS/HTML: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() with 0-255 channels. */
export function extractColours(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
    const h = m[1];
    if (![3, 4, 6, 8].includes(h.length)) continue;
    const rgb = h.length <= 4 ? h.slice(0, 3).split('').map((c) => c + c).join('') : h.slice(0, 6);
    out.add(`#${rgb.toLowerCase()}`);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/g)) {
    const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
    out.add(`#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`);
  }
  return [...out];
}

function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toLab([r, g, b]: Rgb): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour distance. */
export function deltaE(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return Infinity;
  const [l1, a1, b1] = toLab(ra);
  const [l2, a2, b2] = toLab(rb);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** White, black and greys (low chroma) are always allowed: text, shadows, glass tints. */
export function isNeutral(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const [, a, b] = toLab(rgb);
  return Math.hypot(a, b) < 8;
}

export interface Offender {
  colour: string;
  files: string[];
  nearest: string | null;
  dE: number;
}

/** Colours in `files` that are neither neutral nor within `maxDE` of an allowed colour. */
export function paletteOffenders(found: Map<string, string[]>, allowed: string[], maxDE = 12): Offender[] {
  const ok = allowed.map((c) => c.trim().toLowerCase()).filter((c) => hexToRgb(c));
  const out: Offender[] = [];
  for (const [colour, files] of found) {
    if (isNeutral(colour)) continue;
    let nearest: string | null = null;
    let best = Infinity;
    for (const a of ok) {
      const d = deltaE(colour, a);
      if (d < best) {
        best = d;
        nearest = a;
      }
    }
    if (best > maxDE) out.push({ colour, files, nearest, dE: Math.round(best * 10) / 10 });
  }
  return out.sort((x, y) => y.dE - x.dE);
}

const TEXT_EXTS = new Set(['.html', '.css', '.js', '.mjs', '.svg']);

/** colour -> files using it, for the composition's own source files (assets/ and node_modules/ skipped). */
export async function coloursInDir(dir: string): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  async function walk(d: string): Promise<void> {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'assets' || e.name === 'renders') continue;
      const f = join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else if (TEXT_EXTS.has(extname(e.name).toLowerCase())) {
        for (const c of extractColours(await readFile(f, 'utf8'))) {
          const list = found.get(c) ?? [];
          list.push(relative(dir, f));
          found.set(c, list);
        }
      }
    }
  }
  await walk(dir);
  return found;
}
