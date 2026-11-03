---
name: motionable
description: Edit a talking-head video into a reel in the user's own style with the Motionable app (MCP). Use when the user asks to edit, cut, caption or animate a video, or to make a style from reference reels, in Motionable.
---

# Motionable

You direct; the app shows and renders. The plan (`edit-plan.json`) is the only truth. Change it only with `apply_ops`.

## Rules
- No edit without a style. A style comes only from studied references.
- Respect lessons: a batch that breaks one is rejected with the user's own words. Don't retry the same thing.
  `lessons` in the state are the ones no rule checks: follow them. When the user rejects something, `add_lesson`
  in their words (with a rule when one fits).
- Spend few tokens: read `get_project_state` (a diff), not files. Ask for frames only when you must see.
- The user edits in the Studio too. Call `get_project_state` before every batch and build on their changes.
- Every op gets a short `why`.

## Styles
No style yet, or the user brings references: follow `references/style.md` (study → save_style →
write_component → specimen → the user's OK).

## New project
1. `create_project {files}` (clips join in order) → poll `get_project_state` until `next` changes.
2. `transcribe` is paid: ask the user first.
3. `look {project}` once, then pick the camera with a one-line `why`:
   - speaker centred and still → `fixed` (set `center` on the face);
   - speaker moves, sits off-centre, or the video is landscape → `track`;
   - screen recording or no face → `off`.
4. `scaffold_plan {style}`, then `camera.set` with your pick. An older plan without `inputs.track` while the analysis has
   one (`trk_main`): `input.set {key: 'track', asset: 'asset:trk_main@<v>'}`, so captions can keep off the face.
5. `get_project_state {cuts: true}`: `range.cut` the sure ones (`kind`, `evidence`, `why` from the candidate), `range.suggest` the rest.
   Never cut a discourse marker yourself; the user decides.

## Loop
1. `get_project_state` → what changed since your last look. Open `notes` (the user's, at second `t`) come first:
   fix each, and close it in the same batch with `note.resolve {id, reply}` (one sentence). Unclear → ask, leave it open.
2. Decide; one `apply_ops` batch per idea (`base` = the version you read).
3. Warnings: fix or explain them in one line. `look {project, plan: true, from, to}` shows the edit as it is.
4. The user reviews in the Studio (localhost:4377); `render` (draft) only when they ask or approve.

## Ops (most used)
- Captions: `caption.merge {lines}`, `caption.split {line, atWord}`, `caption.setRole`, `caption.hide`, `word.setText {i, text}`.
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
