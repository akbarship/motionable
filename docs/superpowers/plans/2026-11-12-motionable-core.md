# Motionable Core (part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin whose `/motionable` opens a browser Studio where a user goes onboarding → references → plan → HyperFrames preview → chat edits → MP4, with agents running from a file queue inside the user's Claude Code chat.

**Architecture:** One npm package. A Studio server (node:http + SSE + React SPA) and an MCP server share state only through files under `MOTIONABLE_HOME` (default `~/Motionable`). The skill loops on the MCP `next_task` long-poll and dispatches one subagent per task (ref-study, director, executor). Optional generation goes through a provider registry (own keys or bot key).

**Tech Stack:** TypeScript, Node 22+, `@modelcontextprotocol/sdk`, `zod`, `vitest`, Vite + React 18, `tsup` for the server bundles, external CLIs `ffmpeg`/`ffprobe`, `yt-dlp`, `npx hyperframes`.

**Spec:** `docs/superpowers/specs/2026-11-12-motionable-design.md`

## Global Constraints

- Node 22+. No Python, no local ML models.
- **Ask the user before the first `npm install`** and before adding any dependency not listed in Tech Stack.
- Studio binds `127.0.0.1` only; port default `4377`; every API call needs the session token.
- All external tools run via `execFile` with argument arrays, never a shell string.
- Every file write under `MOTIONABLE_HOME` validates against its zod schema and is atomic (temp + rename).
- Every provider kind defaults to `use: "off"`; pipeline must work with no keys.
- Paid calls run only after an Approve click in the Studio.
- Any `gen` item in `plan.json` must carry a `fallback`.
- MCP tool outputs return paths and small JSON, never file contents.
- `skills/motionable/SKILL.md` < 120 lines; each `agents/*.md` < 120 lines; subagent final reply ≤ 5 lines.
- UI copy in Uzbek (Latin), code and comments in English.
- `MOTIONABLE_WAIT_S` default `240`.

## Review Focus

- Studio and MCP both touch tasks at once (user clicks while agent finishes) → no task lost or double-claimed. Test in Task 2.
- Project name with Uzbek letters, spaces, slashes or emoji (`Uy qurish? 5 qadam / v2`) → safe unique id, name shown unchanged. Test in Task 1.
- Reference input that is not an http(s) URL, or an Instagram URL with `?igsh=` params → rejected cleanly / params stripped. Test in Task 6.
- Upload interrupted halfway → no half file appears in b-roll or refs. Test in Task 4.
- Chat edit sent while `execute` is still running → edit waits in the queue, not run in parallel. Test in Task 2.

---

### Task 1: Scaffold, schemas, paths, atomic store

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/core/paths.ts`, `src/core/types.ts`, `src/core/store.ts`
- Test: `tests/core/store.test.ts`, `tests/core/types.test.ts`

**Interfaces:**
- Produces:
  - `home(): string` (env `MOTIONABLE_HOME` else `~/Motionable`), `projectDir(id): string`, `styleDir(id): string`
  - zod: `ProjectSchema`, `StyleSchema`, `PlanSchema`, `TaskSchema`, `ConfigSchema`, `ChatMsgSchema`; types `Project`, `Style`, `Plan`, `Task`, `TaskType`, `TaskStatus`, `Config`, `Kind`
  - `slugId(name: string): string` (ascii slug + 6-char random suffix)
  - `readJson<T>(file, schema): Promise<T>`, `writeJson<T>(file, schema, value): Promise<void>` (atomic)
  - `createProject(input: {name, brief}): Promise<Project>`, `listProjects(): Promise<Project[]>`, `getProject(id)`, `setLast(id)`, `getLast(): Promise<string|null>`

- [ ] **Step 1:** Write `package.json` (type module, scripts `build`, `test`, `dev:studio`), tsconfig (strict, ES2022, NodeNext). Ask the user, then `npm install` deps from Tech Stack.
- [ ] **Step 2: Write failing tests**

```ts
test('slugId keeps ascii and is unique', () => {
  const a = slugId('Uy qurish? 5 qadam / v2'); const b = slugId('Uy qurish? 5 qadam / v2');
  expect(a).toMatch(/^uy-qurish-5-qadam-v2-[a-z0-9]{6}$/); expect(a).not.toBe(b);
});
test('emoji-only name still gives an id', () => expect(slugId('🎬')).toMatch(/^video-[a-z0-9]{6}$/));
test('writeJson rejects invalid data and leaves old file', async () => {
  await writeJson(f, ProjectSchema, valid);
  await expect(writeJson(f, ProjectSchema, {...valid, name: 1} as any)).rejects.toThrow();
  expect((await readJson(f, ProjectSchema)).name).toBe(valid.name);
});
test('createProject keeps original name and sets last', async () => {
  const p = await createProject({name: "Ko'chmas mulk", brief: 'x'});
  expect(p.name).toBe("Ko'chmas mulk"); expect(await getLast()).toBe(p.id);
});
test('PlanSchema rejects gen without fallback', () => {
  expect(PlanSchema.safeParse(planWith({gen: {type:'image', prompt:'p'}, fallback: undefined})).success).toBe(false);
});
```
Tests use a temp `MOTIONABLE_HOME` (set in `beforeEach`).
- [ ] **Step 3:** Run `npx vitest run tests/core` → FAIL (modules missing).
- [ ] **Step 4:** Implement. Schemas copy field names from spec §5 (style.json, plan.json) and §6 (task). `writeJson` = validate → write `file.tmp-<pid>-<rand>` → `rename`.
- [ ] **Step 5:** `npx vitest run tests/core` → PASS.
- [ ] **Step 6:** Commit `feat(core): schemas, paths and atomic store`.

### Task 2: Task queue (file per task, lock claim)

**Files:**
- Create: `src/core/queue.ts`
- Test: `tests/core/queue.test.ts`

**Interfaces:**
- Consumes: `projectDir`, `writeJson`, `TaskSchema` (Task 1)
- Produces:
  - `addTask(projectId, type: TaskType, input: object, status?: 'queued'|'awaiting_approval'): Promise<Task>`
  - `claimNext(): Promise<{projectId, task}|null>` — scans all projects, oldest `queued` first, lock via `open(lock,'wx')`; skips `edit`/`execute`/`render` if another of those is `running` in the same project
  - `progress(projectId, taskId, line: string)`, `finish(projectId, taskId, output: object)`, `fail(projectId, taskId, error: string)`, `approve(projectId, taskId)`, `listTasks(projectId): Promise<Task[]>`
  - `waitForTask(timeoutS: number): Promise<{projectId, task}|null>` — polls `claimNext` every 1 s

- [ ] **Step 1: Write failing tests**

```ts
test('two parallel claims never get the same task', async () => {
  await addTask(p, 'study_ref', {}); await addTask(p, 'study_ref', {});
  const [a, b] = await Promise.all([claimNext(), claimNext()]);
  expect(a!.task.id).not.toBe(b!.task.id);
});
test('edit waits while execute runs in same project', async () => {
  await addTask(p, 'execute', {}); await claimNext();
  await addTask(p, 'edit', {msg: 'x'});
  expect(await claimNext()).toBeNull();
});
test('awaiting_approval is not claimable until approve', async () => {
  const t = await addTask(p, 'generate', {}, 'awaiting_approval');
  expect(await claimNext()).toBeNull(); await approve(p, t.id);
  expect((await claimNext())!.task.id).toBe(t.id);
});
test('stale lock (>30 min, running) is reclaimable', ...);  // set lock mtime with fs.utimes
test('progress lines append in order', ...);
```
- [ ] **Step 2:** `npx vitest run tests/core/queue.test.ts` → FAIL.
- [ ] **Step 3:** Implement in `src/core/queue.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): file queue with lock claim`.

### Task 3: Config with masked keys

**Files:**
- Create: `src/core/config.ts`
- Test: `tests/core/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(): Promise<Config>` (defaults: every kind `{use:'off'}`, `port: 4377`), `saveConfig(patch: Partial<Config>)` (file mode `0o600`), `maskedConfig(c: Config): Config` (keys → `"••••" + last4`)
- `Config.providers: Record<Kind, {use: 'off'|'kie'|'elevenlabs'|'bot', key?: string}>`, `botKey?`, `botUrl?`, `port`

- [ ] **Step 1: Failing tests:** defaults all `off`; saved file mode is `0o600`; `maskedConfig` never contains the full key; saving a masked value (`"••••abcd"`) keeps the old key.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): config with masked keys`.

### Task 4: Studio server (HTTP, token, SSE, upload)

**Files:**
- Create: `src/server/studio.ts`, `src/server/routes.ts`, `src/server/sse.ts`, `src/server/upload.ts`
- Test: `tests/server/studio.test.ts`

**Interfaces:**
- Consumes: store (Task 1), queue (Task 2), config (Task 3)
- Produces:
  - `startStudio({port?, token?}): Promise<{url: string, close(): Promise<void>}>`; writes `home()/studio.json` `{port, token, pid}`
  - Routes (all need `?t=<token>` or header `x-motionable-token`):
    `GET /api/projects`, `POST /api/projects {name, brief}`, `GET /api/projects/:id` (project + tasks + plan?),
    `POST /api/projects/:id/upload?kind=broll|refs` (raw body, `x-filename`), `POST /api/projects/:id/tasks {type, input}`,
    `POST /api/projects/:id/tasks/:tid/approve`, `POST /api/projects/:id/chat {text}` (appends chat.jsonl + adds `edit` task),
    `GET /api/config` (masked), `PUT /api/config`, `GET /api/events` (SSE), `GET /api/claude` → `{connected: boolean}`
  - Serves `dist/studio` static files at `/`
  - SSE event `{type:'project', id}` whenever files under that project change (`fs.watch` recursive, 200 ms debounce)

- [ ] **Step 1: Failing tests** (start on port 0 with temp home):

```ts
test('rejects request without token', async () => expect((await fetch(`${base}/api/projects`)).status).toBe(401));
test('binds to 127.0.0.1 only', () => expect(new URL(url).hostname).toBe('127.0.0.1'));
test('interrupted upload leaves no file', async () => {
  // send half a body then destroy the socket
  expect(await readdir(join(projectDir(id), 'broll'))).toEqual([]);
});
test('upload rejects filename with ../', ...);
test('chat adds edit task', ...);
test('SSE emits project event after task added', ...);
test('config GET is masked', ...);
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement: upload streams into `.part` then renames on `end`; delete `.part` on `aborted`/`error`; cap 2 GB; allowed ext `mp4 mov m4v webm mp3 wav m4a png jpg jpeg webp`. `/api/claude` reads `home()/heartbeat` mtime < 300 s.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): studio api, sse, safe uploads`.

### Task 5: MCP server + integration test

**Files:**
- Create: `src/mcp/server.ts`, `src/cli.ts`
- Test: `tests/mcp/roundtrip.test.ts`

**Interfaces:**
- Consumes: queue (Task 2), `startStudio` (Task 4)
- Produces MCP tools (spec §7): `studio_open`, `next_task`, `task_progress {projectId, taskId, line}`, `task_done {projectId, taskId, summary}`, `task_failed {projectId, taskId, error}`, `project_info {projectId}`. (`generate`, `transcribe` are added in Task 7.)
  - `next_task` touches `home()/heartbeat`, calls `waitForTask(MOTIONABLE_WAIT_S)`, returns `{projectId, task, projectDir, agent: 'ref-study'|'director'|'executor'}` or `{idle: true}`. Agent map: `study_ref→ref-study`, `direct→director`, `execute|edit|render|generate→executor`.
  - `studio_open`: if `studio.json` pid alive and `/api/claude` answers → reuse; else spawn `node dist/cli.js studio` detached. Opens `url + '#/p/' + last` with `open`/`xdg-open`/`start` per platform (execFile). Returns `{url, projectId}`.
  - `cli.ts`: `motionable studio` (runs `startStudio`), `motionable doctor` (checks node ≥22, ffmpeg, yt-dlp, `npx hyperframes doctor --json` `.ok`; prints JSON).

- [ ] **Step 1: Failing test:** with MCP client over in-memory transport + Studio on port 0: POST a task over HTTP → `next_task` returns it with `agent:'ref-study'`; `task_done` → SSE emits; `next_task` with `MOTIONABLE_WAIT_S=1` and empty queue returns `{idle:true}` in < 2 s.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Manually measure the Claude Code MCP tool timeout: register `.mcp.json` locally, call `next_task` with 240 s. If it times out, set default `MOTIONABLE_WAIT_S` to the largest value that passes and note it in spec §14.
- [ ] **Step 6:** Commit `feat(mcp): queue tools and studio launcher`.

### Task 6: Media — ingest and reference sheets

**Files:**
- Create: `src/media/ingest.ts`, `src/media/refsheet.ts`
- Test: `tests/media/ingest.test.ts`, `tests/media/refsheet.test.ts`

**Interfaces:**
- Produces:
  - `normalizeRefUrl(input: string): string` — throws `RefUrlError` for non-http(s); strips query/hash for instagram.com
  - `downloadRef(projectId, url): Promise<string>` — `yt-dlp -f mp4 -o <refs>/%(id)s.%(ext)s <url>`; on failure throws `RefDownloadError('Faylni yuklang')`
  - `probe(file): Promise<{duration, w, h, fps, hasAudio}>` via ffprobe JSON
  - `buildRefSheet(video, outDir): Promise<{cuts: number[], sheets: string[], avgShot: number}>` — ffmpeg `select='gt(scene,0.3)'` + `showinfo` for cut times; one frame per shot (max 36) tiled `tile=4x3`, width 1536, ≤ 3 sheets; writes `cuts.json`
- Wire into server: `POST /api/projects/:id/refs {url}` → normalize → download → add `study_ref` task with `{video, sheetDir}`; refsheet runs before the task is queued so the agent only reads outputs.

- [ ] **Step 1: Failing tests**

```ts
test('rejects non-http', () => expect(() => normalizeRefUrl('file:///etc/passwd')).toThrow(RefUrlError));
test('strips igsh', () => expect(normalizeRefUrl('https://www.instagram.com/reel/ABC/?igsh=xyz'))
  .toBe('https://www.instagram.com/reel/ABC/'));
test('refsheet finds cuts in generated clip', async () => {
  // ffmpeg lavfi: 2s red + 2s blue + 1s green concatenated
  const r = await buildRefSheet(clip, out);
  expect(r.cuts.length).toBe(2); expect(r.sheets.length).toBe(1);
});
```
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(media): ref download and contact sheets`.

### Task 7: Providers (own keys + bot)

**Files:**
- Create: `src/providers/types.ts`, `registry.ts`, `prices.json`, `kie.ts`, `elevenlabs.ts`, `bot.ts`
- Modify: `src/mcp/server.ts` (add `generate`, `transcribe` tools)
- Test: `tests/providers/*.test.ts`, `tests/providers/bot-mock.ts`

**Interfaces:**
- Produces:
  - `type GenReq = {kind: Kind, params: Record<string, unknown>, outDir: string}`
  - `interface GenerationProvider { kinds: Kind[]; quote(r: GenReq): Promise<{usd:number}>; run(r: GenReq): Promise<{file:string, usd:number}> }`
  - `providerFor(kind: Kind, cfg: Config): GenerationProvider | null` (null when `off`)
  - `elevenlabs`: `stt` (Scribe, word timestamps → `words.json` `[{w, start, end}]`), `tts` (→ mp3)
  - `kie`: `image` (Nano Banana 2 / Pro), `video` (Veo 3.1 Fast, Kling) — createTask + poll recordInfo; failed tasks cost 0
  - `bot`: all kinds, spec §8 contract (`/v1/balance`, `/v1/quote`, `/v1/run`, `/v1/jobs/:id`)
  - MCP `generate {projectId, taskId}`: task must be `running` and was approved; runs, appends `gen/gen.log.jsonl`, returns `{file, usd}`. MCP `transcribe {projectId, file}` → `{wordsPath}` or `{error:'no_stt_provider'}`.
  - Server: `POST /api/projects/:id/quote {items}` → `{usd}` for plan review; `GET /api/bot/balance`.

- [ ] **Step 1: Failing tests:** `providerFor('image', defaults)` is null; bot adapter against `bot-mock.ts` (node:http) quotes, runs, polls to `done`, downloads file; bot 402 → error `insufficient_balance`; elevenlabs STT maps mocked response to `words.json` shape; `generate` on a not-approved task is refused.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with global `fetch`; endpoints and model ids go in one const block per adapter; look up current kie.ai and ElevenLabs API docs at implementation time (do not guess).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(providers): own-key adapters and bot adapter`.

### Task 8: Studio UI — shell, onboarding, references, settings

**Files:**
- Create: `studio/index.html`, `studio/vite.config.ts`, `studio/src/main.tsx`, `studio/src/api.ts`, `studio/src/useEvents.ts`
- Create: `studio/src/screens/Onboarding.tsx`, `References.tsx`, `Settings.tsx`, `studio/src/ui/TopBar.tsx`, `studio/src/ui/ClaudePill.tsx`, `studio/src/styles.css`
- Test: `tests/studio/api.test.ts` (api client token handling), manual check in browser

**Interfaces:**
- Consumes: Studio routes (Task 4), refs route (Task 6), config/balance routes (Task 7)
- Produces: hash router `#/new`, `#/p/:id/refs`, `#/p/:id` (pipeline), `#/p/:id/edit`, `#/settings`; `api.ts` reads token from `?t=` once, stores in `sessionStorage`.

- [ ] **Step 1:** Load `impeccable` skill for UI direction; layout per `studio.jpg` (spec §9); light theme.
- [ ] **Step 2:** Failing test: `api.ts` sends `x-motionable-token` on every call. Run → FAIL. Implement. Run → PASS.
- [ ] **Step 3:** Build screens. Onboarding: textarea "Video nima haqida?", "Loyiha nomi", dropzone b-roll/asosiy video → `POST /api/projects` then uploads. References: link input, file drop, saved-styles picker (`GET /api/styles`, add to Task 4 routes), per-ref status chip; "Davom etish" adds `direct` when all refs done. Settings: per-kind select (O'chiq / O'z kalitim (kie.ai yoki ElevenLabs) / Bot) + key field + bot balance.
- [ ] **Step 4:** `npm run build && node dist/cli.js studio`; check in browser: no project → onboarding; existing → last project opens.
- [ ] **Step 5:** Commit `feat(studio): shell, onboarding, references, settings`.

### Task 9: Studio UI — pipeline, plan review, approvals

**Files:**
- Create: `studio/src/screens/Pipeline.tsx`, `studio/src/ui/StageCard.tsx`, `studio/src/ui/PlanReview.tsx`, `studio/src/ui/ApproveCost.tsx`

**Interfaces:**
- Consumes: `GET /api/projects/:id` (tasks, plan), quote + approve routes
- Produces: plan Approve → `POST tasks {type:'execute', input:{useGen: boolean}}`; generate approvals → approve route

- [ ] **Step 1:** Stage cards Study / Direct / Execute with last 5 progress lines live (SSE).
- [ ] **Step 2:** PlanReview: scene list (time, purpose, components, fallback), "Generatsiyadan foydalanish" toggle showing quote; toggle disabled with hint when image/video providers are `off`.
- [ ] **Step 3:** ApproveCost: lists `awaiting_approval` generate tasks with price, Approve / Rad etish (reject = `fail` with `declined`, executor keeps fallback).
- [ ] **Step 4:** Manual browser check with hand-written `plan.json` fixture in a temp home.
- [ ] **Step 5:** Commit `feat(studio): pipeline, plan review, cost approval`.

### Task 10: Editor — live preview, chat, render

**Files:**
- Create: `src/server/preview.ts`, `studio/src/screens/Editor.tsx`, `studio/src/ui/Chat.tsx`
- Modify: `src/server/routes.ts` (preview + render routes)
- Test: `tests/server/preview.test.ts`

**Interfaces:**
- Produces:
  - `ensurePreview(projectId): Promise<{url}>` — runs `npx hyperframes preview` in `comp/` as a child (one per project, reused), parses its URL from stdout; killed when Studio closes
  - `GET /api/projects/:id/preview` → `{url}`; `POST /api/projects/:id/render` → adds `render` task
  - `GET /api/projects/:id/renders/:file` streams mp4

- [ ] **Step 1:** Failing test: `ensurePreview` with a fake `hyperframes` bin on PATH (prints a URL) returns that URL and is reused on second call. Run → FAIL. Implement. Run → PASS.
- [ ] **Step 2:** Editor: preview iframe centre (9:16), Chat right panel (studio.jpg), messages from `chat.jsonl`, attach file (uploads to `broll/`, message references it), "Render" button, finished renders list with player + download.
- [ ] **Step 3:** Manual check against a `hyperframes init` sample in `comp/`.
- [ ] **Step 4:** Commit `feat(editor): preview, chat edits, render`.

### Task 11: Plugin packaging, skill loop, agents

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`
- Create: `skills/motionable/SKILL.md`, `agents/ref-study.md`, `agents/director.md`, `agents/executor.md`
- Create: `src/cli.ts` subcommand `motionable validate <style|plan> <file>`
- Test: `tests/core/validate.test.ts`

**Interfaces:**
- Consumes: MCP tools (Tasks 5, 7), schemas (Task 1)
- Produces:
  - SKILL.md loop: call `studio_open`, tell the user the URL in one line; loop `next_task`; on task dispatch subagent `agent` with only `{projectId, taskId, projectDir, input}`; print one line per finished task; on `{idle:true}` call again silently.
  - ref-study: reads `cuts.json`, sheets, optional `words.json` (`transcribe`); writes `styles/<id>/style.json`; runs `motionable validate style`.
  - director: reads brief, style.json(s), per-clip probe + 1 sheet + words; writes `plan.json`; runs `motionable validate plan`; every scene with `gen` has `fallback`.
  - executor: `execute` builds `comp/` with HyperFrames (load `hyperframes`, `hyperframes-cli`, `hyperframes-registry` skills; registry blocks first); captions from `words.json` when present; gate = `npx hyperframes lint` + `check --json` (fix up to 3 rounds) + snapshot scene midpoints; for `useGen` adds `generate` tasks (`awaiting_approval`) and swaps assets in after approved ones finish. `edit`: change only touched files, `hyperframes timeline` for timing. `render`: `npx hyperframes render --quality delivery --output renders/<ts>.mp4`, verify ffprobe duration = root `data-duration`.
  - Each agent file ends with: "Final reply ≤ 5 lines. Large data stays in files."

- [ ] **Step 1:** Failing test: `validate plan` exits 1 on gen-without-fallback fixture, 0 on valid fixture.
- [ ] **Step 2:** Run → FAIL. Implement `validate`. Run → PASS.
- [ ] **Step 3:** Write manifest, `.mcp.json` (`node ${CLAUDE_PLUGIN_ROOT}/dist/mcp.js`), skill, agents. Check line limits: `wc -l skills/motionable/SKILL.md agents/*.md`.
- [ ] **Step 4:** `claude plugin validate .` (or install from local marketplace) → no errors.
- [ ] **Step 5:** Commit `feat(plugin): skill loop and three agents`.

### Task 12: Installer, README, end-to-end

**Files:**
- Create: `scripts/install.sh`, `scripts/install.ps1`, `README.md`, `docs/e2e-checklist.md`

- [ ] **Step 1:** `install.sh`: check Node ≥22 (else print nvm link), install `yt-dlp` and `ffmpeg` static binaries into `~/.motionable/bin` if missing, `npm ci && npm run build`, `npx hyperframes browser ensure`, print `/plugin marketplace add <path>` + `/plugin install motionable`. `install.ps1` same for Windows.
- [ ] **Step 2:** Run `bash scripts/install.sh` on this Linux machine → `node dist/cli.js doctor` prints `"ok": true`.
- [ ] **Step 3:** README (Uzbek + English short): install, `/motionable`, keys (own or bot), what works without keys.
- [ ] **Step 4:** `docs/e2e-checklist.md`: onboarding → IG link + raw ref → style → plan approve (no gen) → preview → 2 chat edits → render → mp4 plays; repeat with an STT key. **Ask the user before running it** (uses their subscription).
- [ ] **Step 5:** Commit `docs: installer, readme, e2e checklist`.
