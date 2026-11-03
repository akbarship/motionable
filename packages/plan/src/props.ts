// Component props: check them against the component's props schema, fill defaults, and resolve them to what the
// component receives (components.md §3–4): $tokens replaced, anchors → frames from the instance start,
// durations → frames, assets → file paths.
import type {Gradient, PropSpec, Props, TextStyleToken, Tokens} from './types';
import {gradientCss, isRef, lookup, textStyle} from './tokens';
import {parseAnchor} from './timeline';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with `props` (missing values are fine: defaults fill them). */
export const checkProps = (specs: Record<string, PropSpec>, props: Props, tokens: Tokens, path = 'props'): string[] => {
  const issues: string[] = [];
  for (const key of Object.keys(props)) {
    if (!specs[key]) issues.push(`${path}.${key}: not a prop of this component`);
  }
  for (const [key, spec] of Object.entries(specs)) {
    const v = key in props ? props[key] : undefined;
    if (v === undefined) {
      if (spec.default === undefined) issues.push(`${path}.${key}: required (no default)`);
      continue;
    }
    issues.push(...checkValue(spec, v, tokens, `${path}.${key}`));
  }
  return issues;
};

const checkValue = (spec: PropSpec, v: unknown, tokens: Tokens, path: string): string[] => {
  if (isRef(v)) {
    return lookup(tokens, v) === undefined ? [`${path}: unknown token ${v}`] : [];
  }
  switch (spec.type) {
    case 'number':
    case 'integer':
    case 'duration':
      if (spec.type === 'duration' && typeof v === 'string') return /^\d+(\.\d+)?f$/.test(v) ? [] : [`${path}: bad duration "${v}"`];
      if (typeof v !== 'number' || !Number.isFinite(v)) return [`${path}: must be a number`];
      if (spec.type === 'integer' && !Number.isInteger(v)) return [`${path}: must be an integer`];
      if (spec.min !== undefined && v < spec.min) return [`${path}: below min ${spec.min}`];
      if (spec.max !== undefined && v > spec.max) return [`${path}: above max ${spec.max}`];
      return [];
    case 'boolean':
      return typeof v === 'boolean' ? [] : [`${path}: must be true or false`];
    case 'enum':
      return spec.options?.some((o) => o.value === v) ? [] : [`${path}: not one of the options`];
    case 'text':
      if (typeof v !== 'string') return [`${path}: must be text`];
      return spec.maxLength !== undefined && v.length > spec.maxLength ? [`${path}: longer than ${spec.maxLength}`] : [];
    case 'color':
      return typeof v === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? [] : [`${path}: must be a #hex color`];
    case 'gradient':
      return isObject(v) && typeof v.angle === 'number' && Array.isArray(v.stops) ? [] : [`${path}: must be {angle, stops}`];
    case 'textStyle':
      return isObject(v) && typeof v.font === 'string' && typeof v.size === 'number' ? [] : [`${path}: must be a text style`];
    case 'font':
      return typeof v === 'string' ? [] : [`${path}: must be a font name`];
    case 'anchor':
      try {
        parseAnchor(String(v));
        return [];
      } catch {
        return [`${path}: bad anchor "${String(v)}"`];
      }
    case 'asset':
      return typeof v === 'string' && v.startsWith('asset:') ? [] : [`${path}: must be asset:<id>`];
    case 'array': {
      if (!Array.isArray(v)) return [`${path}: must be a list`];
      if (spec.maxItems !== undefined && v.length > spec.maxItems) return [`${path}: more than ${spec.maxItems} items`];
      return v.flatMap((item, i) => (spec.items ? checkValue(spec.items, item, tokens, `${path}[${i}]`) : []));
    }
    case 'object': {
      if (!isObject(v)) return [`${path}: must be an object`];
      return checkProps(spec.fields ?? {}, v, tokens, path);
    }
  }
};

export type PropContext = {
  tokens: Tokens;
  fps: number;
  start: number; // the instance's first output frame
  anchor: (a: string) => number; // absolute output frame
  asset: (ref: string) => string; // file path
};

/** Fill defaults and resolve every value to what the component receives. */
export const resolveProps = (specs: Record<string, PropSpec>, props: Props, ctx: PropContext): Props =>
  Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, resolveValue(spec, key in props ? props[key] : spec.default, ctx)]),
  );

const resolveValue = (spec: PropSpec, raw: unknown, ctx: PropContext): unknown => {
  if (raw === undefined) return undefined;
  const v = isRef(raw) ? lookup(ctx.tokens, raw) : raw;
  switch (spec.type) {
    case 'gradient':
      return gradientCss(v as Gradient);
    case 'textStyle':
      return textStyle(ctx.tokens, v as TextStyleToken);
    case 'anchor':
      return ctx.anchor(String(v)) - ctx.start;
    case 'duration': {
      if (typeof v === 'string') return Math.round(Number(v.slice(0, -1)));
      return Math.round((v as number) * ctx.fps);
    }
    case 'asset':
      return ctx.asset(String(v));
    case 'array':
      return (v as unknown[]).map((item) => (spec.items ? resolveValue(spec.items, item, ctx) : item));
    case 'object':
      return resolveProps(spec.fields ?? {}, v as Props, ctx);
    default:
      return v;
  }
};
