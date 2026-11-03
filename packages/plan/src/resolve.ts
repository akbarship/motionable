// The resolver (edit-plan.md §11): plan + style + analysis + component manifests → the resolved plan.
// Ported from Motionable's resolve.ts, camera.ts and the layout logic in PlanVideo.tsx, generalized to the plan format.
import type {CaptionLine as KitLine} from './render-types';
import type {
  CameraMode, ComponentManifest, EditPlan, Framing, Props, Shot, Style, TextStyleToken, Tokens, Track, Transcript, Word,
} from './types';
import type {RCaptionBlock, ROverlay, RShot, RTransition, ResolvedPlan} from './resolved';
import {buildTimeline, resolveAnchor, toFrames, type AnchorContext} from './timeline';
import {deepMerge, gradeCss, resolveTokens, textStyle} from './tokens';
import {resolveProps} from './props';
import {mix, reveal, tween} from './easing';

export type AssetInfo = {path: string; meta?: Record<string, unknown>};

export type ResolveInput = {
  plan: EditPlan;
  style: Style;
  transcript: Transcript;
  track: Track | null; // null: no face track, so the camera can't be in track mode
  components: Record<string, ComponentManifest>;
  asset: (ref: string) => AssetInfo;
  taste?: Tokens;
};

export class ResolveError extends Error {}

const fail = (msg: string): never => {
  throw new ResolveError(msg);
};

/** The plan's words with the transcript edits applied. */
export const wordsOf = (plan: EditPlan, transcript: Transcript): Word[] =>
  transcript.words.map((w) => (plan.transcript.edits[String(w.i)] ? {...w, text: plan.transcript.edits[String(w.i)]} : w));

/** The tokens in force for this plan: style → taste → plan. */
export const planTokens = (plan: EditPlan, style: Style, taste?: Tokens): Tokens =>
  deepMerge<Tokens>(style.tokens, taste, plan.tokens);

const STYLE_KEYS: (keyof TextStyleToken)[] = ['font', 'weight', 'size', 'tracking', 'caps', 'italic', 'keep', 'fill', 'shadow'];
export const LINE_STYLE_KEYS = STYLE_KEYS;

/** Speakers in view: 1 per track sample, 0 inside runs without a face of at least `minS`, ramped over `rampS`. */
export const noFaceMask = (samples: Track['samples'], fps: number, minS = 0.8, rampS = 0.4): number[] => {
  const n = samples.length;
  const hard = samples.map((x) => (x.found ? 1 : 0));
  for (let i = 0; i < n; ) {
    if (samples[i].found) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !samples[j].found) j++;
    if ((j - i) / fps < minS) for (let k = i; k < j; k++) hard[k] = 1;
    i = j;
  }
  const r = Math.max(1, Math.round(rampS * fps));
  return hard.map((_, i) => {
    let sum = 0;
    let cnt = 0;
    for (let k = i - r; k <= i + r; k++) {
      sum += hard[Math.max(0, Math.min(n - 1, k))];
      cnt++;
    }
    return sum / cnt; // a moving average: 0 inside long runs without a face, 1 with one, a ramp between
  });
};

export const resolvePlan = (input: ResolveInput): ResolvedPlan => {
  const {plan, style, track, components} = input;
  const fps = plan.canvas.fps;
  const W = plan.canvas.w;
  const H = plan.canvas.h;
  const tokens = planTokens(plan, style, input.taste);
  const rtokens = resolveTokens(tokens, fps);
  const words = wordsOf(plan, input.transcript);
  const map = buildTimeline(plan.timeline.segments, fps);
  const total = map.totalFrames;
  const manifest = (ref: string) => components[ref] ?? fail(`unknown component ${ref}`);
  const assetPath = (ref: string) => input.asset(ref).path;

  // ---------- shots ----------
  const baseCtx: AnchorContext = {map, words, anchorLead: rtokens.timing.anchorLead};
  const starts = plan.shots.map((s, i) => (i === 0 ? 0 : resolveAnchor(s.from, baseCtx)));
  const shotSpans = plan.shots.map((s, i) => ({s, start: starts[i], end: i === plan.shots.length - 1 ? total : starts[i + 1]}));
  const shotById = new Map(shotSpans.map((x) => [x.s.id, x]));
  const ctx: AnchorContext = {
    ...baseCtx,
    shot: (id, end) => {
      const x = shotById.get(id) ?? fail(`unknown shot ${id}`);
      return end ? x.end : x.start;
    },
  };
  const anchor = (a: string) => resolveAnchor(a, ctx);

  const zoneOf = (s: Shot) =>
    s.captionZone ?? (s.kind === 'motion' ? tokens.captionZone?.motion ?? tokens.captionZone?.broll : undefined)
      ?? tokens.captionZone?.[s.kind === 'broll' ? 'broll' : (s.level ?? '')] ?? fail(`no caption zone for shot ${s.id}`);
  const propCtx = (start: number) => ({tokens, fps, start, anchor, asset: assetPath});
  const lead = rtokens.timing.captionLead;
  const wf = (i: number) => map.srcToFrame((words[i] ?? fail(`no word ${i}`)).start);

  const shots: RShot[] = shotSpans.map(({s, start, end}) => {
    const out: RShot = {id: s.id, kind: s.kind, start, end, captionY: zoneOf(s)};
    if (s.kind === 'motion') {
      const inst = s.scene ?? fail(`motion shot ${s.id} has no scene`);
      const m = manifest(inst.component);
      if (m.kind !== 'scene') fail(`${inst.component} is a ${m.kind}, not a scene`);
      // the words spoken in this shot, as the scene sees them (the caption lead applied, like captions)
      const spoken = plan.captions.lines.flatMap((l) => l.words).filter((i) => wf(i) >= start && wf(i) < end);
      out.scene = {
        component: inst.component,
        props: resolveProps(m.props, inst.props ?? {}, propCtx(start)),
        words: spoken.map((i) => ({id: i, text: words[i].text, start: Math.max(0, wf(i) - lead - start), end: map.srcToFrame(words[i].end) - start})),
      };
    }
    if (s.kind === 'broll') {
      // a named grade must exist; with none named and no "broll" grade in the style, the clip plays as it is
      const grade = tokens.grade?.[s.grade ?? 'broll'] ?? (s.grade ? fail(`unknown grade ${s.grade}`) : {});
      out.broll = {
        src: assetPath(s.clip ?? fail(`b-roll shot ${s.id} has no clip`)),
        trimBefore: Math.round((s.clipIn ?? 0) * fps),
        zoom: s.crop?.zoom ?? 1,
        origin: [(s.crop?.origin[0] ?? 0.5) * 100, (s.crop?.origin[1] ?? 0.5) * 100],
        grade: gradeCss(grade),
      };
    }
    return out;
  });

  // ---------- camera: per output frame, by mode (track / fixed / off); track is Motionable camera.ts ----------
  const srcMeta = input.asset(plan.inputs.source).meta ?? {};
  const SW = track?.w ?? Number(srcMeta.w ?? fail('the source has no size: add w/h to its asset meta'));
  const SH = track?.h ?? Number(srcMeta.h ?? fail('the source has no size: add w/h to its asset meta'));
  const cover = Math.max(W / SW, H / SH);
  const contain = Math.min(W / SW, H / SH);
  const trackFps = track?.fps ?? fps;
  // without a track: one "no face" sample, so the face-avoiding logic knows there's nothing to avoid
  const samples = track?.samples.length ? track.samples : [{t: 0, cx: 0.5, cy: 0.5, w: 0, h: 0, found: false}, {t: 1, cx: 0.5, cy: 0.5, w: 0, h: 0, found: false}];
  const planMode: CameraMode = plan.camera?.mode ?? (track ? 'track' : 'fixed');
  const center = plan.camera?.center ?? [0.5, 0.42]; // a seated speaker's face sits a little above the middle
  const modeOf = (s: Shot): CameraMode => {
    const m = s.camera ?? planMode;
    if (m === 'track' && !track) fail(`shot ${s.id} is in track mode, but this video has no face track`);
    return m;
  };
  const faceAt = (t: number): [number, number, number, number] => {
    const x = Math.max(0, Math.min(samples.length - 1.001, t * trackFps));
    const i = Math.floor(x);
    const k = x - i;
    const [a, b] = [samples[i], samples[i + 1]];
    return [a.cx + (b.cx - a.cx) * k, a.cy + (b.cy - a.cy) * k, a.w + (b.w - a.w) * k, a.h + (b.h - a.h) * k];
  };
  const framingOf = (s: Shot, fallback: string): Framing => {
    const level = s.kind === 'speaker' ? (s.level ?? fail(`speaker shot ${s.id} has no level`)) : fallback;
    const f = tokens.framing?.[level] ?? fail(`unknown framing level ${level}`);
    return {zoom: s.zoom ?? f.zoom, face: s.face ?? f.face};
  };
  // under b-roll the camera keeps the previous speaker level (it's hidden, but transitions can show its edge)
  const levelBefore: string[] = [];
  let lastLevel = style.rules.framing.levels[0];
  for (const {s} of shotSpans) {
    if (s.kind === 'speaker' && s.level) lastLevel = s.level;
    levelBefore.push(lastLevel);
  }
  // Footage can run for a while without the speaker's face (a screen recording, a product, the speaker walking out).
  // There the tracker's guesses are just interpolation, so the camera eases to the whole frame, centred, and
  // components that avoid the face are told it isn't there. Short misses (a turn of the head) stay tracked.
  const seen = noFaceMask(samples, trackFps);
  const seenAt = (t: number) => {
    const x = Math.max(0, Math.min(seen.length - 1.001, t * trackFps));
    const i = Math.floor(x);
    return seen[i] + (seen[i + 1] - seen[i]) * (x - i);
  };
  const camera: [number, number, number][] = [];
  const face: [number, number, number, number][] = [];
  const faceSeen: number[] = [];
  let si = 0;
  for (let f = 0; f < total; f++) {
    while (si < shotSpans.length - 1 && f >= shotSpans[si].end) si++;
    const {s, start, end} = shotSpans[si];
    const mode = modeOf(s);
    const t = map.frameToSrc(f);
    const fb = faceAt(t);
    const v = seenAt(t);
    face.push(fb);
    faceSeen.push(Math.round(v * 1000) / 1000);
    if (mode === 'off') {
      // the whole source fits the canvas, centred (letterboxed when the aspect differs)
      camera.push([contain, (SW - W / contain) / 2, (SH - H / contain) / 2]);
      continue;
    }
    const fr = framingOf(s, levelBefore[si]);
    const k = (f - start) / Math.max(1, end - start);
    let zoom = mode === 'fixed' ? fr.zoom[0] : mix(k, fr.zoom[0], fr.zoom[1]); // track: slow push inside every shot
    if (s.intro && mode === 'track') {
      const d = toFrames(s.intro.dur, fps);
      zoom = mix(tween(f - start, 0, d, reveal), s.intro.zoom, fr.zoom[0]) + (fr.zoom[1] - fr.zoom[0]) * k;
    }
    let aim: number[];
    let target: number[];
    if (mode === 'fixed') {
      // one still crop: the chosen source point at the canvas centre; the shot's level still sets the zoom
      aim = center;
      target = [0.5, 0.5];
    } else {
      // no face: blend to zoom 1 (the whole source filling the canvas), centred
      zoom = mix(v, 1, zoom);
      aim = [mix(v, 0.5, fb[0]), mix(v, 0.5, fb[1])];
      target = [mix(v, 0.5, fr.face[0]), mix(v, 0.5, fr.face[1])];
    }
    const scale = cover * zoom;
    const cw = W / scale;
    const ch = H / scale;
    const left = Math.max(0, Math.min(SW - cw, aim[0] * SW - target[0] * cw));
    const top = Math.max(0, Math.min(SH - ch, aim[1] * SH - target[1] * ch));
    camera.push([scale, left, top]);
  }

  // ---------- captions: one block per run of lines with the same component, per shot ----------
  const lineStyle = (role: string, overrides: Partial<TextStyleToken> | undefined) => {
    const base = tokens.type?.[role] ?? fail(`no text style for role ${role}`);
    return textStyle(tokens, {...base, ...overrides});
  };
  // The face is the one safe area: a caption block whose zone would cover the face (over the block's whole span,
  // as the camera frames it) moves below it, or above when there's no room below. The x axis never moves.
  const faceMargin = tokens.safe?.face ?? 40;
  const edge = Math.round(H * 0.05);
  const faceSpan = (from: number, to: number) => {
    let top = Infinity, bottom = -Infinity;
    for (let f = Math.max(0, from); f < Math.min(total, to); f++) {
      if (faceSeen[f] < 0.5) continue;
      const [s, l, tp] = camera[f];
      const [cx, cy, fw, fh] = face[f];
      top = Math.min(top, ((cy - fh / 2) * SH - tp) * s);
      bottom = Math.max(bottom, ((cy + fh / 2) * SH - tp) * s);
    }
    return top < bottom ? {top: top - faceMargin, bottom: bottom + faceMargin} : null;
  };
  const placeOffFace = (zone: number, height: number, from: number, to: number) => {
    const f = faceSpan(from, to);
    if (!f || zone + height / 2 <= f.top || zone - height / 2 >= f.bottom) return {y: zone};
    const below = f.bottom + height / 2;
    if (below + height / 2 <= H - edge) return {y: Math.round(below), moved: {from: zone}};
    const above = f.top - height / 2;
    if (above - height / 2 >= edge) return {y: Math.round(above), moved: {from: zone}};
    return {y: Math.round(H - edge - height / 2), moved: {from: zone, onFace: true}};
  };

  const captionBlocks: RCaptionBlock[] = [];
  const lines = plan.captions.lines.filter((l) => !l.hidden);
  for (const {s, start, end} of shotSpans) {
    // a motion scene shows the words itself; captions draw over it only if the shot asks for a caption component
    if (s.kind === 'motion' && !s.captions) continue;
    const shotChoice = s.captions ?? {component: plan.captions.component, props: plan.captions.props};
    const inShot = lines.filter((l) => wf(l.words[0]) >= start && wf(l.words[0]) < end);
    const runs: {component: string; props: Props; lines: typeof inShot}[] = [];
    for (const l of inShot) {
      const choice = l.component ? {component: l.component, props: l.props ?? {}} : {component: shotChoice.component, props: shotChoice.props ?? {}};
      const last = runs[runs.length - 1];
      if (last && last.component === choice.component && JSON.stringify(last.props) === JSON.stringify(choice.props)) last.lines.push(l);
      else runs.push({...choice, lines: [l]});
    }
    runs.forEach((r, ri) => {
      const next = runs[ri + 1];
      const blockStart = wf(r.lines[0].words[0]) - lead;
      const until = next ? wf(next.lines[0].words[0]) - lead : end;
      const m = manifest(r.component);
      if (m.kind !== 'caption') fail(`${r.component} is a ${m.kind}, not a caption component`);
      const kitLines: KitLine[] = r.lines.map((l) => ({
        id: l.id,
        role: l.role,
        style: lineStyle(l.role, l.style),
        words: l.words.map((i) => ({
          id: i,
          text: words[i].text,
          start: wf(i) - lead - blockStart,
          end: map.srcToFrame(words[i].end) - blockStart,
        })),
      }));
      // a block shows up to two lines at once: its height is about the two biggest line sizes
      const sizes = kitLines.map((l) => l.style.size).sort((a, b) => b - a);
      const place = placeOffFace(zoneOf(s), (sizes[0] + (sizes[1] ?? 0)) * 1.15, blockStart, until);
      captionBlocks.push({
        id: `${s.id}-${ri}`,
        shot: s.id,
        component: r.component,
        props: resolveProps(m.props, r.props, propCtx(blockStart)),
        start: blockStart,
        end,
        until: until - blockStart,
        hardEnd: end - blockStart,
        y: place.y,
        ...(place.moved ? {moved: place.moved} : {}),
        lines: kitLines,
        needsFace: m.needs.includes('face'),
      });
    });
  }

  // ---------- overlays, transitions, sfx ----------
  const overlays: ROverlay[] = plan.overlays.map((o) => {
    const m = manifest(o.component);
    if (m.kind !== 'overlay') fail(`${o.component} is a ${m.kind}, not an overlay`);
    const start = anchor(o.from);
    const end = anchor(o.to);
    if (end <= start) fail(`overlay ${o.id} ends before it starts`);
    return {
      id: o.id,
      component: o.component,
      start,
      end,
      attach: o.attach ?? 'screen',
      depth: o.depth ?? 'front',
      props: resolveProps(m.props, o.props ?? {}, propCtx(start)),
      needsFace: m.needs.includes('face'),
    };
  });

  const transitions: RTransition[] = plan.transitions.map((x) => {
    const m = manifest(x.component);
    if (m.kind !== 'transition') fail(`${x.component} is a ${m.kind}, not a transition`);
    const span = shotById.get(x.shot) ?? fail(`transition ${x.id}: unknown shot ${x.shot}`);
    const frames = m.frames ?? fail(`${x.component} has no frames`);
    return {
      id: x.id,
      component: x.component,
      cut: span.start,
      before: frames.before,
      after: frames.after,
      props: resolveProps(m.props, x.props ?? {}, propCtx(span.start)),
      needsFace: m.needs.includes('face'),
    };
  });

  // sounds play for their own length (asset meta), clipped at the video's end
  const lengthOf = (ref: string, fallbackS: number) => {
    const m = input.asset(ref).meta ?? {};
    const s = Number(m.duration ?? m.durationS);
    return Math.round((Number.isFinite(s) && s > 0 ? s : fallbackS) * fps);
  };
  const sfx = plan.sfx.map((x) => {
    const frame = anchor(x.at);
    return {id: x.id, src: assetPath(x.sound), frame, gain: x.gain ?? 0, frames: Math.max(1, Math.min(lengthOf(x.sound, 2), total - frame))};
  });
  const fadeOut = plan.audio.fadeOut ?? 0;
  const m = plan.audio.music;
  const musicStart = m?.from ? anchor(m.from) : 0;
  const audio: ResolvedPlan['audio'] = {
    music: m ? {src: assetPath(m.asset), start: musicStart, frames: Math.max(1, Math.min(lengthOf(m.asset, 9999), total - musicStart)),
      gain: m.gain ?? -18, fadeIn: m.fadeIn ?? 0.5, fadeOut: m.fadeOut ?? Math.max(fadeOut, 1.5)} : null,
    fadeOut,
  };

  let matte: ResolvedPlan['matte'] = null;
  if (plan.inputs.matte) {
    const info = input.asset(plan.inputs.matte);
    matte = {src: info.path, startS: Number(info.meta?.startS ?? 0)};
  }

  const kinds = Object.fromEntries(Object.entries(components).map(([ref, m]) => [ref, m.kind]));

  return {
    job: plan.job,
    version: plan.version,
    canvas: plan.canvas,
    totalFrames: total,
    source: {src: assetPath(plan.inputs.source), w: SW, h: SH},
    speakerGrade: gradeCss(tokens.grade?.base ?? {}),
    segments: map.segments.map((g) => ({id: g.id, start: g.start, len: g.len, trimBefore: Math.round(g.s * fps), srcIn: g.s})),
    camera,
    face,
    faceSeen,
    shots,
    captionBlocks,
    overlays,
    transitions,
    matte,
    sfx,
    audio,
    brollCaptionShade: style.rules.broll?.captionShade ?? false,
    tokens: rtokens,
    kinds,
  };
};
