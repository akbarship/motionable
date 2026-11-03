---
name: motionable
description: Edit a talking-head video into a reel in the user's own style with the Motionable app (MCP). Use on /motionable, or when the user asks to edit, cut, caption or animate a video, or to make a style from reference reels, in Motionable.
---

# Motionable

You direct; the app shows and renders. The plan (`edit-plan.json`) is the only truth. Change it only with `apply_ops`.

## Rules
- No edit without a style. A style comes only from studied references.
- Respect lessons: a batch that breaks one is rejected with the user's own words. Don't retry the same thing.
  `lessons` in the state are the ones no rule checks: follow them. When the user rejects something, `add_lesson`
  in their words (with a rule when one fits). About the look (captions, type, colour, motion): `about: 'style'`,
  `scope: 'style:<name>'`. About the craft (legibility, clean joins, no generic kit): `about: 'craft'`, global.
- The references decide the look. A measured value beats any global taste lesson; only the style's own lessons
  change it.
- Spend few tokens: read `get_project_state` (a diff), not files. Ask for frames only when you must see.
- The user edits in the Studio too. Call `get_project_state` before every batch and build on their changes.
- Every op gets a short `why`.

## /motionable (start here)
1. `npm run -s setup` in the Motionable folder (`~/.motionable/app` from the installer, the plugin folder, or a clone). `next` not `done` (an `optional:` step
   counts as done): follow `references/onboarding.md`, then come back.
2. `wait_for_studio` → first call starts the app and returns `{idle, url}`. Open the URL for the user
   (`xdg-open` / `open` / `start`; in Claude Desktop the built-in browser beside the chat). Say in one line:
   "Studio ochiq: yangi video boshlang, men shu yerdan kuzatyapman."
3. Loop: `wait_for_studio` → a request `{id, kind, project|style, text, todo}` → do it → next call
   `wait_for_studio {done: id, reply}` (one sentence the Studio shows) → it waits for the next one.
   - Say each step in one line in the chat. `idle` back: just wait again, quietly.
   - The user can press Esc and talk to you; when they're done, call `wait_for_studio` again.
   - Paid steps (transcribe) the Studio has already confirmed with the user.

## Styles
No style yet, or the user brings references: follow `references/style.md` (study → save_style →
write_component → specimen → the user's OK).

## Requests from the Studio
- `plan` (a new video from the wizard): `get_project_state {cuts: true}` once: the `brief` (about, script, mode, style)
  comes on the first read only. Analysis running: wait. No transcript: ask in the chat (paid), `transcribe` on their OK.
  `brief.style` without `@version` is still being built (its `style` request comes first): use its newest version.
  1. A script: compare it with the transcript and fix misheard words with `word.setText` after scaffolding; build the
     scenes on the script's beats (hook, points, CTA).
  2. `look {project}` once (edit mode) and pick the camera with a one-line `why`:
     speaker centred and still → `fixed` (set `center`); moves, off-centre or landscape → `track`; no face → `off`.
  3. `propose_plan`: a 2–3 sentence `summary`, `scenes` in output seconds (`title`, `what` happens on screen,
     `why`: the reference, the script or a lesson), `cuts` in source seconds with `why`, `audio`, `delivery`.
     A paced voiceover keeps its pauses: `pauses: 'keep'`. No edits yet. Reply: "Reja tayyor: N sahna, ~X s."
  4. Stock b-roll (the style's `rules.broll.source` is `stock` or `mixed`): `find_broll {query, orientation}` per scene
     that needs one, `add_broll` the fitting pick. No key or nothing fits: list them in `propose_plan.needs`
     (`what`, `when`); the Studio asks the user to upload them.
- `revise`: `text` is the user's change in their words. A new `propose_plan`; `add_lesson` if it's a taste rule.
- `approve`: `scaffold_plan {style}` (the proposal's), `camera.set` with your pick, then build it scene by scene:
  `range.cut` the proposed cuts (`kind`, `evidence`, `why`), `range.suggest` the unsure ones (never cut a discourse
  marker yourself), then captions, shots, overlays, transitions, sound. One `apply_ops` per idea. Never render.
- `notes`: the Loop below. `style`: `references/style.md`.
- Voiceover (`mode: voiceover`): the source is a flat picture under the voice; the camera is off. Every second
  needs a shot that isn't the base: `motion` shots, `broll` from the user's files, overlays. `look` the plan, not the sheet.

## Loop
1. `get_project_state` → what changed since your last look. Open `notes` (the user's, at second `t`) come first:
   fix each, and close it in the same batch with `note.resolve {id, reply}` (one sentence). Unclear → ask, leave it open.
2. Decide; one `apply_ops` batch per idea (`base` = the version you read).
3. Warnings: fix or explain them in one line. `look {project, plan: true, from, to}` shows the edit as it is.
4. The user reviews in the Studio (localhost:4377); `render` (draft) only when they ask or approve.

## Ops (most used)
- Captions: `caption.merge {lines}`, `caption.split {line, atWord}`, `caption.setRole`, `caption.hide`,
  `word.setText {word, text}` (`""` hides a spoken word), `caption.tone {line, word, tone: accent|alert|null}` (one word in colour).
- Timeline: `range.cut {from, to, kind, why}`, `range.restore`, `range.suggest`, `pause.keep`, `pause.trim`.
- Shots: `shot.insert {after, shot: {id, from, kind, level, why}}`, `shot.update`, `shot.remove`.
- Camera: `camera.set {mode: track|fixed|off, center?}` for the video, or `{shot, mode}` (null clears). Ask the user before tracking if they said no zoom.
- Overlays: `overlay.add {overlay: {id, component, from, to, props}}`, `overlay.retime`, `overlay.remove`.
- B-roll: the user's files are in `files` (`br_*` video). `shot.insert {after, shot: {id, from, kind: 'broll', clip: 'asset:br_x', clipIn}}`.
- Notes: `note.add {text, at?, to?}`, `note.resolve {id, reply}`, `note.reopen {id}`.
- Sound (the user's `aud_*` files): `sfx.add {sfx: {id, sound: 'asset:aud_x', at, gain}}` (dB);
  `audio.set {set: {music: {asset, gain: -18, from?}, fadeOut: 1}}` (music bed; the video's sound fades out).
- Transitions: `transition.add {transition: {id, shot, component, props}}` (ids: letters, digits, `_`).
- Anchors: `word:N`, `word:N.end`, `t:S`, `cut:N`, `shot:ID`, `end`, offsets `+0.2` or `+2f`.
