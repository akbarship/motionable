# Motionable — design spec (part A: plugin + Studio + agents)

Date: 2026-11-12. Status: architecture approved in chat; spec awaiting user review.

## 1. Goal

A free Claude Code plugin that makes short videos (reels) from the user's footage, guided by references.
The user works in a browser Studio; Claude Code agents do the work from a queue; every step is visible in the Studio.

Success:
- `/motionable` opens the Studio in the browser automatically.
- A new user goes onboarding → references → plan → preview → chat edits → MP4 without touching the terminal.
- The pipeline works with **no API keys** (no generation, no auto captions) and gets better with keys.
- Low token use: agents read compact files (JSON, contact sheets), never raw video.

Out of scope here (part B, own spec): the Telegram bot aggregator backend, payments, balances.
Part A defines only the HTTP contract the bot must serve (section 8).

## 2. Decisions (from the brainstorm)

| Topic | Decision |
|---|---|
| Agent runner | Inside the user's own Claude Code chat. Main session polls the queue over MCP and runs one subagent per stage. No headless `claude -p`. |
| Engine | HyperFrames (HTML → video). Live preview via `npx hyperframes preview`. |
| Reference analysis | Local: ffmpeg scene cuts + 2–3 contact-sheet images + STT words (if a key exists). No Gemini needed. |
| Generation | Optional. Every director item that wants generation also carries a no-generation fallback. |
| Providers | Each kind (`image`, `video`, `tts`, `stt`) is set to: off, own key (kie.ai for image/video, ElevenLabs for stt/tts) or bot key. |
| Install weight | Light: Node 22+, ffmpeg, yt-dlp, Chrome (HyperFrames). No Python, no local ML models. |
| Paid calls | Each paid call shows its price in the Studio and waits for an Approve click, except STT, which runs automatically once the user enables an STT provider in Settings (the Settings screen states the cost). |

## 3. Architecture

```
Claude Code chat ──/motionable──▶ skill (SKILL.md)
      │                              │ ensures Studio server runs (127.0.0.1:4377) and opens browser
      ▼                              ▼
  MCP server  ◀──── files ────▶  Studio server  ◀── SSE/HTTP ──▶  Browser (React SPA)
  next_task / progress / done    ~/Motionable/...                   onboarding, refs, pipeline,
      │                                                             editor (preview + chat), settings
      ├─ subagent ref-study  → styles/<id>/style.json
      ├─ subagent director   → projects/<id>/plan.json
      └─ subagent executor   → projects/<id>/comp/ (HyperFrames project) → renders/*.mp4

GenerationProvider { image | video | tts | stt }
   adapters: kie (image, video), elevenlabs (tts, stt), bot (all four)
```

One npm package holds everything. The MCP server and the Studio server are separate processes that share state
only through files under `~/Motionable` (atomic write: temp file + rename). The Studio server watches those files
and pushes changes to the browser over SSE.

## 4. Repository layout

```
.claude-plugin/plugin.json          plugin manifest
.claude-plugin/marketplace.json     single-plugin marketplace (install by git URL)
.mcp.json                           runs dist/mcp.js
skills/motionable/SKILL.md          the loop; < 120 lines
agents/ref-study.md                 subagent prompts; each < 120 lines
agents/director.md
agents/executor.md
src/core/       paths.ts, types.ts (zod schemas), store.ts, queue.ts, config.ts
src/media/      ingest.ts (yt-dlp, ffprobe), refsheet.ts (scene cuts, contact sheets), audio.ts
src/providers/  types.ts, registry.ts, kie.ts, elevenlabs.ts, bot.ts
src/server/     studio.ts (node:http), routes.ts, sse.ts, upload.ts, preview.ts (hyperframes preview child)
src/mcp/        server.ts (tools below)
src/cli.ts      `motionable studio|doctor` entry
studio/         Vite + React SPA (built into dist/studio)
scripts/install.sh, scripts/install.ps1
tests/          vitest
```

## 5. Data on disk

```
~/Motionable/
  config.json                 providers + keys (file mode 600), studio port
  last.json                   { projectId } last opened project
  styles/<styleId>/           reusable styles from studied references
    style.json  sheets/*.jpg  source.json (url or file, date)
  projects/<projectId>/
    project.json              id, name, brief, status, styleIds[], createdAt
    broll/                    user uploads
    refs/                     downloaded or uploaded reference videos
    tasks/<taskId>.json       one file per task (see 6); tasks/<taskId>.lock while claimed
    plan.json                 director output
    comp/                     HyperFrames project (index.html, scenes/*.html, assets/)
    gen/                      generated assets + gen.log.jsonl (provider, cost, prompt)
    chat.jsonl                Studio chat
    renders/                  final mp4s
```

Schemas live in `src/core/types.ts` (zod). Every file write validates first.

### style.json (bounded, ≤ 2 KB)
`pace` (avg shot length s, cuts/min), `framing`, `captions` (font family guess, weight, case, position, highlight
style, words per line), `textCards` (when, look), `transitions[]`, `colour` (palette hex, grade note),
`motion[]` (named moves with timing), `audio` (music energy, sfx use), `doNot[]`, `sheets[]` (paths).

### plan.json (director output)
```
{ "format": {"w":1080,"h":1920,"fps":30}, "duration": 33.0, "styleIds": [...],
  "captions": {"on": true, "style": "...", "source": "stt|script|none"},
  "scenes": [{
     "id": "s1", "start": 0, "end": 3.2, "purpose": "hook",
     "footage": {"src": "broll/a.mp4", "in": 1.2, "out": 4.4} | null,
     "components": [{"kind": "title|lower-third|caption|card|chart|overlay|transition", "description": "...", "props": {}}],
     "gen": {"type": "image|video", "prompt": "...", "seconds": 5} | null,
     "fallback": "what to show when gen is off or fails (b-roll / typography / stock)"
  }],
  "audio": {"voice": "footage|tts|none", "music": "path|null"},
  "genEstimate": {"items": 3, "usd": 1.4}
}
```
Rule: `fallback` is required whenever `gen` is set. The executor builds the fallback version first.

## 6. Queue

Task: `{ id, type, status, input, progress[], output, error, createdAt }`, one file per task so the Studio and MCP
processes never rewrite each other's tasks. `next_task` claims a task by creating `<id>.lock` with `O_EXCL`;
the oldest queued task wins. A lock older than 30 min with the task still `running` is treated as dead.
Types: `study_ref`, `direct`, `execute`, `edit`, `render`, `generate`.
Status: `queued → running → done | failed`; `generate` starts as `awaiting_approval`.

Who adds tasks:
- Studio adds `study_ref` per new reference, then `direct` when all refs are done (or when the user picks saved styles).
- Studio adds `execute` when the user approves the plan.
- Studio chat adds `edit` per user message. Only one `edit` runs at a time; later ones queue.
- Studio adds `render` on the Render button.
- Executor may create `generate` tasks; they wait for the user's Approve in the Studio.

## 7. MCP tools (small outputs, paths not content)

| Tool | Does | Returns |
|---|---|---|
| `studio_open` | starts Studio server if down, opens browser, opens last project | `{url, projectId|null}` |
| `next_task` | long-poll up to `MOTIONABLE_WAIT_S` (default 240 s), marks task running | task or `{idle:true}` |
| `task_progress` | appends a short line shown live in Studio | `ok` |
| `task_done` / `task_failed` | closes the task, stores output summary | `ok` |
| `project_info` | paths + status for a project | small JSON |
| `generate` | runs an approved `generate` task through the provider registry | asset path + cost |
| `transcribe` | STT through the provider registry → `words.json` | path |

The skill loop: `studio_open` → repeat `next_task` → dispatch the matching subagent with only
`{taskId, projectDir, paths}` → subagent writes files, calls `task_progress`, then `task_done` → main session
prints one line. Idle polls cost ~100 tokens each.

## 8. Providers

```ts
interface GenerationProvider {
  kinds: Kind[];                        // 'image' | 'video' | 'tts' | 'stt'
  quote(req): Promise<{ usd: number }>;
  run(req): Promise<{ file: string; usd: number }>;
}
```
`config.json`: `{ "providers": { "stt": {"use": "elevenlabs", "key": "..."}, "image": {"use": "kie", "key": "..."}, ... },
"botKey": "...", "botUrl": "https://..." }`. `use: "off"` is the default for every kind.

Bot HTTP contract (part B implements it), Bearer `botKey`:
- `GET /v1/balance` → `{usd}`
- `POST /v1/quote` `{kind, model?, params}` → `{usd}`
- `POST /v1/run` `{kind, model?, params}` → `{jobId}`; `GET /v1/jobs/:id` → `{status, url?, usd?, error?}`

Prices are never hard-coded in the plugin: own-key adapters use a small editable price table in
`src/providers/prices.json`; the bot quotes its own.

## 9. Studio screens

Layout follows `studio.jpg`: top bar (logo, Home, Styles, Videos, Claude status pill, "New video"),
project bar (name, status), centre canvas, right chat panel.

1. **Onboarding** (no project): what the video is about, project name, drop b-roll and main footage.
2. **References**: paste Instagram links, drop raw videos, or pick saved styles. Each shows its study status.
3. **Pipeline**: three stage cards (Study, Direct, Execute) with live progress lines from the queue.
   Plan review: scene list with components and fallbacks, a "Use generation" toggle with total quote, Approve button.
4. **Editor**: HyperFrames preview iframe in the centre, chat on the right (edits), Render button. Finished MP4 is
   playable and downloadable.
5. **Settings**: per-kind provider choice + key fields (keys shown masked), bot key + balance.

The Claude pill shows "connected" when `next_task` polled in the last 300 s; otherwise it tells the user to run
`/motionable` in Claude Code.

## 10. Agents and token budget

- **ref-study**: input = `refsheet` output (`cuts.json`, ≤ 3 contact sheets, `words.json` if any). Writes
  `style.json`. Never opens the video.
- **director**: input = brief, `style.json`s, footage summaries (duration, `words.json`, 1 sheet per clip).
  Writes `plan.json`. Must give every scene a fallback.
- **executor**: builds `comp/` from `plan.json` with HyperFrames (registry blocks first, hand-built second),
  runs `hyperframes lint` + `check --json`, snapshots scene midpoints, then reports. For `edit` tasks it changes
  only the files the request touches, using `hyperframes timeline` for timing edits.
- Each subagent's final reply to the main session is ≤ 5 lines. Large data stays in files.
- Previously studied styles are reused without re-study.

## 11. Errors

- yt-dlp failure (private reel, login wall): ref marked failed with "upload the file instead".
- No STT key: captions source becomes `script` (user pastes text) or `none`; the Studio says so.
- Generation failure or decline: executor keeps the fallback; the task shows the error.
- `hyperframes check` errors: executor fixes and re-runs up to 3 times, then fails the task with the findings.
- Studio server down when MCP needs it: `studio_open` restarts it.
- Claude not connected: tasks stay `queued`; the pill shows how to connect.

## 12. Security

- Studio binds to 127.0.0.1 only, with a random session token in the URL; the API refuses requests without it.
- Keys live only in `config.json` (mode 600); the API returns them masked.
- External tools are run with argument arrays (`execFile`), never a shell string. URLs are checked to be http(s).
- Upload size cap (default 2 GB) and file-type check.

## 13. Testing

- vitest unit tests: schemas, store (atomic writes), queue transitions, config masking, provider adapters
  (mocked `fetch`), refsheet on a 5 s generated test clip.
- Integration: Studio server + MCP server against a temp `MOTIONABLE_HOME`; a task added over HTTP comes out of
  `next_task`; `task_done` reaches the browser over SSE.
- Bot adapter tested against a local mock that implements section 8.
- Manual end-to-end checklist on a sample reel (needs the user's consent: it uses their subscription).

## 14. Open risks

- Claude Code MCP tool timeout vs 240 s long-poll: measure in phase 3; lower `MOTIONABLE_WAIT_S` if needed.
- Instagram download can break when Instagram changes; raw upload is always offered.
- kie.ai has no SLA: the bot (part B) keeps fal.ai as its fallback; the plugin's own-key path is kie only.
- Reselling ElevenLabs / kie.ai output through the bot: check each provider's terms before part B launches.
- Telegram requires Stars for digital goods inside bots; part B must compare Stars vs an external payment page.
