// The resolved plan → one HyperFrames page (index.html). The page is a build artifact: it's rebuilt from the plan,
// never edited by hand. The base clip plays under the tracked camera; captions, overlays and transitions are the
// style's own components (docs/v2/components.md). Captions fall back to plain debug text while a style has none.
import type {ComponentManifest, ResolvedPlan} from '@motionable/plan';
import {componentCss, tokenFonts} from './css';
import {MC_RUNTIME} from './runtime';

export {MC_RUNTIME, componentCss, tokenFonts};

export type ComposeInput = {
  plan: ResolvedPlan;
  base: string; // the conformed base clip, root-relative (e.g. "assets/base.mp4")
  manifests: Record<string, ComponentManifest>; // name@version → manifest (prop types, to turn frames into seconds)
  scripts: Record<string, string>; // name@version → root-relative component.js path; missing ones aren't mounted
  css?: Record<string, string>; // name@version → the component's CSS (componentCss), inlined so fonts resolve
  gsap?: string;
};

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
const r4 = (x: number) => +x.toFixed(4);

type Instance = {id: string; ref: string; kind: string; start: number; end: number; props: Record<string, unknown>; ctx: Record<string, unknown>};

export const compose = ({plan: r, base, manifests, scripts, css = {}, gsap = GSAP}: ComposeInput) => {
  const {w, h, fps} = r.canvas;
  const sec = (frames: number) => r4(frames / fps);
  const dur = sec(r.totalFrames);
  // anchor and duration props arrive as frames from the instance start: components get absolute seconds
  const timedProps = (ref: string, props: Record<string, unknown>, start: number) => {
    const spec = manifests[ref]?.props ?? {};
    return Object.fromEntries(Object.entries(props).map(([k, v]) =>
      [k, typeof v === 'number' && spec[k]?.type === 'anchor' ? sec(start + v) : typeof v === 'number' && spec[k]?.type === 'duration' ? sec(v) : v]));
  };

  const instances: Instance[] = [];
  const debug: {html: string; tweens: string}[] = [];
  // debug captions sit on the frame's centre line with a small side margin (no safe area: the whole frame is ours)
  const margin = Math.round(w * 0.05);

  for (const b of r.captionBlocks) {
    const lines = b.lines.filter((l) => l.words.length);
    if (scripts[b.component]) {
      instances.push({
        // a block ends where the next block of the shot starts (a line with its own component splits the shot's captions)
        id: `cap-${b.id}`, ref: b.component, kind: 'caption', start: sec(b.start), end: sec(b.start + Math.min(b.until, b.hardEnd)),
        props: timedProps(b.component, b.props, b.start),
        ctx: {y: Math.round(b.y), lines: lines.map((l) => ({id: l.id, role: l.role, style: l.style,
          words: l.words.map((wd) => ({text: wd.text, start: sec(b.start + wd.start), end: sec(b.start + wd.end)}))}))},
      });
      continue;
    }
    // debug captions: each line shows from its first word until the next line starts (or the block ends)
    const html = lines.map((l, li) => `<div id="l${b.id}-${li}" class="cap-line">${l.words.map((wd) =>
      `<span id="w${b.id}-${wd.id}" class="cap-word">${esc(wd.text)}</span>`).join(' ')}</div>`).join('');
    const tweens = lines.map((l, li) => {
      const on = sec(b.start + l.words[0].start);
      const off = sec(b.start + (li + 1 < lines.length ? lines[li + 1].words[0].start : Math.min(b.until, b.hardEnd)));
      const words = l.words.map((wd) => `tl.fromTo("#w${b.id}-${wd.id}",{opacity:0.35},{opacity:1,duration:0.08},${sec(b.start + wd.start)});`).join('');
      return `tl.fromTo("#l${b.id}-${li}",{opacity:0},{opacity:1,duration:0.001},${on});tl.to("#l${b.id}-${li}",{opacity:0,duration:0.001},${off});${words}`;
    }).join('');
    debug.push({
      html: `<div id="cap-${b.id}" class="clip cap" data-start="${sec(b.start)}" data-duration="${sec(Math.min(b.until, b.hardEnd))}" data-track-index="2" style="top:${Math.round(b.y)}px">${html}</div>`,
      tweens,
    });
  }
  for (const o of r.overlays) {
    if (!scripts[o.component]) throw new Error(`overlay ${o.id}: component ${o.component} has no component.js`);
    instances.push({id: `ov-${o.id}`, ref: o.component, kind: 'overlay', start: sec(o.start), end: sec(o.end), props: timedProps(o.component, o.props, o.start), ctx: {}});
  }
  for (const x of r.transitions) {
    if (!scripts[x.component]) throw new Error(`transition ${x.id}: component ${x.component} has no component.js`);
    const start = x.cut - x.before;
    instances.push({id: `tr-${x.id}`, ref: x.component, kind: 'transition', start: sec(start), end: sec(x.cut + x.after), props: timedProps(x.component, x.props, start), ctx: {cut: sec(x.cut)}});
  }

  // b-roll shots: the clip covers the frame for the shot (muted, its own grade and crop), inside #fx so transitions move it too
  const brolls = r.shots.filter((s) => s.broll).map((s) => {
    const b = s.broll!;
    return `<video id="br-${s.id}" class="clip broll" src="${b.src}" data-start="${sec(s.start)}" data-duration="${sec(s.end - s.start)}" data-media-start="${sec(b.trimBefore)}" data-track-index="1" muted playsinline style="transform:scale(${b.zoom});transform-origin:${b.origin[0]}% ${b.origin[1]}%;filter:${b.grade}"></video>`;
  }).join('\n');

  // sound: each effect on its own lane at its frame, the music bed under everything; gains in dB → linear volume
  const vol = (db: number) => +(10 ** (db / 20)).toFixed(6);
  const sounds = [
    ...r.sfx.map((x, i) => `<audio id="sfx-${x.id}" class="clip" src="${x.src}" data-start="${sec(x.frame)}" data-duration="${sec(x.frames)}" data-track-index="${10 + i}" data-volume="${vol(x.gain)}"></audio>`),
    ...(r.audio.music ? [`<audio id="music" class="clip" src="${r.audio.music.src}" data-start="${sec(r.audio.music.start)}" data-duration="${sec(r.audio.music.frames)}" data-track-index="9" data-volume="${vol(r.audio.music.gain)}" data-fade-in="${r.audio.music.fadeIn}" data-fade-out="${r.audio.music.fadeOut}"></audio>`] : []),
  ].join('\n');

  const page = {
    canvas: {w, h}, fps, tokens: r.tokens, source: {w: r.source.w, h: r.source.h},
    cam: r.camera.map(([s, l, t]) => [r4(s), Math.round(l), Math.round(t)]),
    face: r.face.map((f) => f.map((v) => +v.toFixed(3))),
    seen: r.faceSeen,
  };
  const used = [...new Set(instances.map((i) => i.ref))];
  const fonts = tokenFonts(r.tokens.type);
  const z = {caption: 20, overlay: 30, transition: 40} as Record<string, number>;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script src="${gsap}"></script>
<script>${MC_RUNTIME}</script>
${used.filter((ref) => css[ref]).map((ref) => `<style data-mc="${ref}">${css[ref]}</style>`).join('\n')}
${used.map((ref) => `<script src="${scripts[ref]}"></script>`).join('\n')}
<style>
html,body{margin:0;background:#000}
#root{position:absolute;inset:0;overflow:hidden}
#fx{position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;transform-origin:50% 50%}
#cam{position:absolute;left:0;top:0;width:${r.source.w}px;height:${r.source.h}px;transform-origin:0 0}
#base{position:absolute;left:0;top:0;width:100%;height:100%}
.broll{position:absolute;left:0;top:0;width:${w}px;height:${h}px;object-fit:cover}
.mc{position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none}
.cap{position:absolute;left:${margin}px;width:${w - 2 * margin}px;text-align:center;z-index:10}
.cap-line{position:absolute;left:0;right:0;top:0;opacity:0;font:700 64px Inter;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.cap-word{display:inline-block}
${fonts.css}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${w}" data-height="${h}" data-fps="${fps}" data-layout-allow-overflow>
${fonts.html}
<div id="fx"><div id="cam"><video id="base" class="clip" src="${base}" data-start="0" data-duration="${dur}" data-track-index="0" playsinline data-has-audio="true"${r.audio.fadeOut ? ` data-fade-out="${r.audio.fadeOut}"` : ''}></video></div>
${brolls}</div>
${sounds}
<div id="captions" data-track-kind="captions">
${debug.map((b) => b.html).join('\n')}
</div>
${instances.map((i) => `<div id="${i.id}" class="clip mc mc-${i.kind}" data-start="${i.start}" data-duration="${r4(i.end - i.start)}" data-track-index="${z[i.kind] / 10}" style="z-index:${z[i.kind]}"></div>`).join('\n')}
</div>
<script>
const PAGE=${JSON.stringify(page)};
const camEl=document.getElementById("cam");
function camAt(t){const c=PAGE.cam[Math.min(PAGE.cam.length-1,Math.max(0,Math.round(t*PAGE.fps)))];camEl.style.transform="translate("+(-c[1]*c[0])+"px,"+(-c[2]*c[0])+"px) scale("+c[0]+")";}
window.addEventListener("hf-seek",(e)=>camAt(e.detail.time));
camAt(0);
const tl=gsap.timeline({paused:true});
${debug.map((b) => b.tweens).join('\n')}
for (const inst of ${JSON.stringify(instances)}) MC.mount(inst, PAGE, tl);
tl.set({},{},${dur});
window.__timelines=window.__timelines||{};
window.__timelines["main"]=tl;
</script>
</body>
</html>
`;
};
