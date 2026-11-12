# Quality pass: references, storyboard, exact style, director — plan (2026-11-13)

Status: **approved 2026-11-13, built** (A-G in commit after f0938cd). Paid gen in the E2E: ~6–8 kie images, about $0.25–0.35.

Source: user feedback after a real run on project `~/Motionable/projects/cc-video-bmqsti` (script "Claude Code: 5 narsa", reference reel `DfVGKreSIOx`, style `dfvgkresiox-n9eeac`).

## User feedback (verbatim points)

1. Saving Instagram videos worked only once. Manual video upload must also be possible. Reference study should start only when all references are added.
2. A storyboard is needed before the full video, for both the agents and the person.
3. Muharrir (Editor) does not need the HyperFrames studio; just show the video itself.
4. Reference mode gave something similar, but the user needs the **exact** style, with follow-up questions (e.g. which colour palette is main). It must recreate animations and backgrounds especially. Photo generation did not work.
5. The director still acts like AI slop.

## Root causes found

1. **Instagram:** `src/media/ingest.ts` uses `-f mp4/best`. For reel `DfCi2s4zNno` this picks progressive format `3` on `instagram.ftas2-2.fna.fbcdn.net`, which fails DNS from the user's network ("Temporary failure in name resolution", 10 retries, timeout). DASH formats (`bv*+ba/b`) come from `ftas2-1` and downloaded fine. Every error is swallowed into "Faylni yuklang". yt-dlp lives only in `~/.motionable/bin` (2026.10.26).
2. **Upload:** a Dropzone already exists (`studio/src/screens/References.tsx`, right column) but reads as secondary. Each added ref creates a `study_ref` task at once.
3. **Gen:** `~/Motionable/config.json` does not exist, so every provider is `off`. The director then plans 0 gen assets, and the execute step ran with `useGen:false`. Keys exist only in the repo `.env` (`kie_api`, `elevenlabs_api`), which the Studio never reads. Nothing in the UI said gen was off.
4. **Style not exact:** the reference (contact grid) has these, and `style.json` records only names ("card swap", "toggle flip"), with no timing, ease, blur or sizes:
   - a bokeh background (soft blurred blobs) on a navy to blue gradient;
   - glass cards;
   - real logos (GitHub, OpenAI, Mistral, Gemini);
   - a vertical icon carousel with motion blur;
   - blur-in text reveals;
   - a laptop illustration with flowing digits;
   - left- and right-aligned card layouts.
5. **Director slop:** snapshots of the built video show every scene with the same grammar:
   - one dark card, one centred headline, the same grey radial blob;
   - placeholder content ("stek: Next.js", "Birinchi savol");
   - no real logos or UI, no camera moves, no variety.

## Useful free tools (HyperFrames CLI 0.9.39)

- `npx hyperframes measure events|curve|frames --range a,b --roi x,y,w,h|look|ink`: timing, GSAP-ease fit, consecutive frames, colour look, text ink size.
- `npx hyperframes snapshot --at t,... --against <ref video>`: render/reference pair sheet.
- `npx hyperframes diff <video> <project-or-render>`.
- Recipes for glass, gradient type, directional motion blur, ghost trails, masks, flash and grain: `~/.claude/skills/reverse-any-video/references/match.md`.
- Do not use `hyperframes reverse` or `templates`; they are HyperFrames Pro (paid).

## Plan

Order: A → D → F → C+G → B → E → E2E → commit/push. Each step ends with its tests. After approval, run without check-ins (memory: just-finish-dont-reask).

### A. References screen
- `downloadRef`: try format selectors in order:
  1. `bv*[vcodec^=avc1]+ba`
  2. `bv*+ba/b`
  3. `mp4/best`
- Use `--retries 3` for each selector.
- Map stderr to an Uzbek reason: network/DNS, login required, private or removed post, unknown. Keep a tail of stderr in the server log.
- Show "Instagram havolasi" and "Videoni yuklang" as two equal options side by side.
- Adding a ref only stores the file (status "qo'shildi"). A **"O'rganishni boshlash"** button creates ONE `study_ref` task with all ref videos. The ref-study agent must handle several videos and write one style.
- Tests: format fallback order (stub yt-dlp via `MOTIONABLE_YTDLP`), error mapping, the single-task study trigger.

### B. Follow-up questions after study
- After `study_ref` is done, the Studio asks 3–4 short questions, each with the reference's value as default:
  - main palette: reference or own colours;
  - font;
  - keep the background exactly;
  - accent colour.
- Store the answers in `project.json` (`styleAnswers`). The director and executor treat them as hard rules.

### C. Exact style (ref-study + executor)
- Ref-study measures every animation and the background with `hyperframes measure` (events, curve, frames --range, look, ink).
- `style.json` gains:
  - `recipes[]`: name, element, trigger, duration, GSAP ease, from and to values, blur/motion-blur params, exact CSS;
  - `background`: gradient stops, blob positions, colours and blur radius over time;
  - `materials`: glass blur, border, opacity, radius;
  - `type`: family candidates, sizes from ink;
  - `assetsNeeded`: logos, illustrations to generate.
- Update the zod schema and the validator.
- The executor implements recipes verbatim. After each scene it checks with `hyperframes snapshot --against <ref>` and fixes visible mismatches once.

### D. Generation actually on
- `loadConfig` falls back to env `KIE_API_KEY` and `ELEVENLABS_API_KEY` when no key is stored.
- Fill the user's `~/Motionable/config.json` (mode 0600) from the repo `.env`. Never print the keys.
- PlanReview shows a clear banner when image gen is off: "Rasm generatsiyasi o'chiq → Sozlamalar".
- When image gen is on, the director must take illustrations (laptop etc.) from gen, never draw them in code.

### E. Storyboard stage (between plan approval and the full build)
- New task type `storyboard`. The executor builds each scene as one static key frame: the real design, no animation. Then `hyperframes snapshot` takes one still per scene.
- Studio Storyboard screen:
  - a grid of stills with the VO line under each;
  - a comment box per frame, which creates a `storyboard_edit` task;
  - "Tasdiqlash", which creates `execute` to animate the same scenes (no rebuild).
- Tests: task flow and routes.

### F. Muharrir (Editor)
- Remove the HyperFrames preview iframe from `studio/src/screens/Editor.tsx`. Show a `<video>` of the latest render.
- Auto-queue a render after `execute` and after each `edit`. Use draft quality if the CLI supports it.
- While rendering, keep the previous video with a "yangilanmoqda" badge.
- The preview server code stays only if something else uses it; otherwise delete it.

### G. Director anti-slop (`agents/director.md`)
- **Scene grammar:**
  - Take a grammar list from the reference (icon carousel, connector chain, stat card, chat bubbles, full-bleed illustration, big type, etc.).
  - Use at least 4 different grammars per video.
  - Never use the same grammar in two adjacent scenes.
- **One real hero visual per scene**, one of:
  - a faithful rebuild of the real Claude Code UI;
  - a real logo via `npx hyperframes media-use resolve --type logo`;
  - a gen image.
- **No placeholder content:** for example, `CLAUDE.md` shows real lines a user would write.
- **Self-check before submit:** a slop checklist (same grammar, placeholder text, centred card + headline every time, the same background blob every time). Rewrite the plan if any item fails.

### Verification
- `npm test`, `npm run typecheck`, `npm run build`.
- E2E on `cc-video-bmqsti` with the same reference: storyboard, then the full render.
- Output: a reference vs render pair contact sheet. Judge it against the gaps listed above.

## Already done in this session
- `f0938cd` fix(doctor): judge HyperFrames by required checks only (pushed).
- The plugin is installed locally: `motionable@motionable`, user scope, read from this repo. Restart Claude Code to load the MCP.
- Script: `/home/akbarshox/Desktop/jobs/claude-code-5-tips/script.md`.
- Voice for it: ElevenLabs returned 401 `payment_issue` (subscription `past_due`). The generator script is `/tmp/claude-1000/-home-akbarshox-Desktop-motionable/abeb5c06-b4b4-416f-91b2-75baef9c58e7/scratchpad/tts.py`, voice `Akbarshox` = `LKuPYD3RvMtPPc73VAez`, model `eleven_v3`, 7 parts. It is in the session scratchpad and may be gone; rewrite it if needed.
