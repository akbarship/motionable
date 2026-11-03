# Components (v2, HyperFrames)

A style's motion vocabulary. Claude writes each one from scratch for the user's style; nothing is shipped built in.

## Files: `~/Motionable/styles/<style>/<v>/components/<name>/<v>/`
- `component.json`: the manifest (`packages/plan/schema/component.schema.json`): `kind` (caption, overlay, transition), `props` (typed, with defaults), `needs` (`face`), `status` (draft until the gate passes).
- `component.js`: one browser script. Versions never change once public; a change is a new version.

## component.js
```js
MC.define('pop-title@1', {
  css: `.pop-title{position:absolute;font:900 96px Inter;color:var(--c)}`,
  // build the DOM inside `root` (the timed instance, full canvas) and add tweens to `tl` at absolute seconds
  build(root, p, ctx, tl) {
    const el = ctx.el('div', 'pop-title', p.text);
    root.append(el);
    tl.fromTo(el, {scale: 0.6, opacity: 0}, {scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)'}, ctx.start);
    tl.to(el, {opacity: 0, duration: 0.25}, ctx.end - 0.25);
  },
});
```
- `p`: the instance's props, validated, defaults filled, `$tokens` resolved, anchors turned into seconds.
- `ctx`: `start`, `end` (s), `canvas {w,h}`, `tokens` (resolved colours, gradients, text styles),
  `el(tag, class, text)`, `letters(text)` (keeps oʻ gʻ ʼ whole), `face(t)` → `{cx,cy,w,h}` in canvas px or null.
- Captions also get `ctx.lines`: `[{id, role, style, words: [{text, start, end}]}]` (seconds), and `ctx.y`: the centre of
  the block. Draw around it: resolve has already moved it off the face (`tokens.safe.face` px clear, default 40).
- Transitions get `ctx.cut` (s) and `ctx.cam` (the footage wrapper) to animate around the cut.

## Rules (the gate checks the first five)
1. Pure function of time: no `Date.now`, `Math.random` (use `ctx.random(seed)`), timers, fetch, `repeat:-1`.
2. Only `fromTo` / `to` on the timeline, at absolute times inside `[start, end)`; nothing animates `display`.
3. Text stays inside the frame (about 5 % side margin) and off the face; on the frame's centre line unless the style says
   otherwise. The face is the only safe area; the gate fails caption text that covers its test face.
4. Uzbek letters render (oʻ gʻ ʼ, long words, two lines).
5. Same frame twice gives the same pixels.
6. Colours, fonts and sizes come from `ctx.tokens` or props, never hard-coded, so one component serves the style.

## Gate (`run_gate`)
Test page per case (Uzbek text, long text, min/max props, over footage) → `hyperframes check` (lint, layout),
snapshot twice (pixels equal), a contact sheet for Claude to look at. Pass → `status: private`.
