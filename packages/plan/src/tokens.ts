// Design tokens: merging (component defaults → style → taste → plan → props) and $references (edit-plan.md §5).
import type {Fill, ResolvedTokens, TextStyle} from './render-types';
import type {Grade, Gradient, Shadow, TextStyleToken, Tokens} from './types';
import {toFrames} from './timeline';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge; arrays and scalars from later layers replace earlier ones. */
export const deepMerge = <T>(...layers: (Partial<T> | undefined)[]): T => {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k] as object, v) : v;
    }
  }
  return out as T;
};

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const gradientCss = (g: Gradient) =>
  `linear-gradient(${g.angle}deg, ${g.stops.map(([c, at]) => `${c} ${round(at * 100)}%`).join(', ')})`;

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

export const shadowCss = (s: Shadow) => {
  const [r, g, b] = hexToRgb(s.color);
  return `${s.x ?? 0}px ${s.y}px ${s.blur}px rgba(${r},${g},${b},${s.opacity})`;
};

/** Grades are numbers in the plan; this is the CSS filter, in Motionable's order. */
export const gradeCss = (g: Grade) =>
  [`contrast(${g.contrast ?? 1})`, `saturate(${g.saturation ?? 1})`, `brightness(${g.brightness ?? 1})`].join(' ');

/** Look up "$group.name" or "$group.name.field" in the tokens. Returns undefined if it doesn't exist. */
export const lookup = (tokens: Tokens, ref: string): unknown => {
  if (!ref.startsWith('$')) return undefined;
  let cur: unknown = tokens;
  for (const part of ref.slice(1).split('.')) {
    if (!isObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
};

export const isRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith('$');

const fillOf = (tokens: Tokens, fill: string | undefined): Fill => {
  if (!fill) return {kind: 'color', color: tokens.color?.text ?? '#FFFFFF'};
  if (fill.startsWith('$gradient.')) {
    const g = lookup(tokens, fill) as Gradient | undefined;
    if (!g) throw new Error(`unknown token ${fill}`);
    return {kind: 'gradient', css: gradientCss(g)};
  }
  const color = isRef(fill) ? (lookup(tokens, fill) as string | undefined) : fill;
  if (!color) throw new Error(`unknown token ${fill}`);
  return {kind: 'color', color};
};

export const textStyle = (tokens: Tokens, t: TextStyleToken): TextStyle => {
  let shadow: string | undefined;
  if (t.shadow) {
    const s = lookup(tokens, t.shadow) as Shadow | undefined;
    if (!s) throw new Error(`unknown token ${t.shadow}`);
    shadow = shadowCss(s);
  }
  return {
    font: t.font,
    weight: t.weight,
    size: t.size,
    tracking: t.tracking ?? 0,
    caps: !!t.caps,
    italic: !!t.italic,
    keep: !!t.keep,
    fill: fillOf(tokens, t.fill),
    shadow,
  };
};

/** The tokens as components see them: CSS strings and frames, nothing left to look up. */
export const resolveTokens = (tokens: Tokens, fps: number): ResolvedTokens => {
  const map = <A, B>(o: Record<string, A> | undefined, f: (a: A) => B) =>
    Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, f(v)]));
  return {
    color: {...(tokens.color ?? {})},
    gradient: map(tokens.gradient, gradientCss),
    type: map(tokens.type, (t) => textStyle(tokens, t)),
    shadow: map(tokens.shadow, shadowCss),
    timing: {
      anchorLead: tokens.timing?.anchorLead ?? 0,
      captionLead: toFrames(tokens.timing?.captionLead ?? 0, fps),
      minHold: toFrames(tokens.timing?.minHold ?? 0, fps),
    },
  };
};
