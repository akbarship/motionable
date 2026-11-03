# Making a style (the user's own design system)

A style is learned from the user's reference reels: their technique, never their footage or words. No defaults:
every value is measured from a reference, comes from this style's own lesson, or is marked a guess. Global lessons
about the look don't apply here: the references win over them.

## 1. Study
- `study_reference {style, files}` → cuts, cuts/min, average shot, pacing per reference.
- `look {style, ref}` → contact sheet. Then `look {style, ref, from, to}` on 2–4 moments that carry the style
  (the hook, a title, a caption run, a transition). Measure: type (family feel, weight, size vs frame, case),
  colour (3–5 hex), caption system (words per line, position, how words appear), motion (entry, easing, duration
  in frames, exit), framing (zoom levels, punch-ins per minute), transitions, density, SFX moments.
- B-roll: how much of each reference is cutaway footage (stock, the creator's own, none) and what it shows →
  `rules.broll {shareOfRuntime, source: stock|own|none|mixed, subjects: [english words]}`. Scenes drawn in code
  (illustration, diagrams) are components, not b-roll.
- Note what to avoid as `never` items.

## 2. save_style
`style.json` (schema `motionable.style/1`). Fill only what you measured; keep it small:
```json
{"schema":"motionable.style/1","name":"kofe-pop","version":1,"title":{"en":"Kofe Pop"},"description":"…",
 "tags":[],"fits":{"footage":["talking-head"],"framing":["W","M"],"lengthS":[15,90],"speakers":1},
 "canvas":{"w":1080,"h":1920,"fps":30},"madeFrom":{"kind":"reference"},"author":{"kind":"coder"},"owner":null,
 "status":"private","refs":["ref-a"],
 "tokens":{"color":{"ink":"#111111","accent":"#FA5602"},"type":{"cap":{"font":"Inter","weight":800,"size":72}},
   "framing":{"W":{"zoom":[1.0,1.04],"face":[0.5,0.32]},"M":{"zoom":[1.25,1.3],"face":[0.5,0.3]}},
   "captionZone":{"W":1180,"M":1220,"broll":1220}},
 "rules":{"timeline":{"trimPausesOver":0.45,"trimTo":0.25,"naturalPause":{"afterSentence":0.35,"afterComma":0.2},
   "retakes":"auto-when-sure","filler":"suggest"},"framing":{"levels":["W","M"]},
   "shots":{"targetS":[2.5,5],"maxS":8},"captions":{"wordsPerLine":[1,3],"maxLines":2,"lowConfidence":0.6}},
 "triggers":[],"components":{"captions":{"component":"kofe-captions@1"}},
 "never":[{"id":"no-text-on-face","text":"text never covers the face"}],
 "sources":{"tokens.color.accent":"ref:ref-a@3.2","rules.shots.targetS":"ref:ref-a"}}
```
- `sources`: dotted path → `ref:<id>@<s>`, `lesson:<id>` or `guess`. Every measured value gets one.
- Harmony first: text and face share the frame's centre line. The only safe area is the face: `tokens.safe.face` (px).
- `brief`: at most 30 lines, in plain words: what makes this style recognisable.

## 3. write_component
One per need named in `components` (captions first), per `docs/v2/components.md`: `MC.define('<name>@<v>', {css,
build(root, p, ctx, tl)})`. Colours, fonts and sizes from `ctx.tokens` or props. The gate must pass; read its
errors and its sheet, fix, call again. A public component never changes: write version + 1.

## 4. Specimen
`look {project, style: "<name>@<v>", from, to}`: the user's footage in the style, 6–8 stills. Show it to the user
and wait for their OK before editing with it. Their "no" becomes a lesson.
