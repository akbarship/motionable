# SDD ledger — plan: docs/superpowers/plans/2026-11-12-motionable-core.md
Spec: docs/superpowers/specs/2026-11-12-motionable-design.md. Branch feat/core from ef87128. npm deps approved by user (list in plan Tech Stack + react-dom, @vitejs/plugin-react, @types/node, @types/react).

## Preflight scan
| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1→T2..T11 | store/schemas/paths | ok |
| T2↔T7/T11 | claimNext exclusive set vs generate swapping comp files | conflict: generate edits comp/ concurrently with edit |
| T4↔T6,T7,T8,T10 | routes.ts owned by T4; later tasks add routes | Files lists of T6/T7/T8 omit routes.ts |
| T5↔T11 | T5 creates src/cli.ts; T11 lists it as Create | should be Modify |
| T1↔T5/T11 | build outputs dist/mcp.js, dist/cli.js | T1 must define tsup entries |
| T11 executor flow | execute "swaps assets after approved generate finish" | execute task would block on user approval |
| Each task self-consistency | tests vs code vs files | T1..T12 consistent apart from rows above |

Ruling: claimNext exclusive set = execute|edit|render|generate per project — generate swaps comp files — cost if wrong: generate waits behind edits (slower, safe).
Ruling: T6/T7/T8/T10 may modify src/server/routes.ts to add their routes — spec §9 needs them — cost if wrong: none.
Ruling: T11 modifies (not creates) src/cli.ts — T5 created it — cost: none.
Ruling: T1 package.json build = tsup with entries {mcp: src/mcp/server.ts, cli: src/cli.ts} → dist/mcp.js, dist/cli.js, plus `vite build studio` → dist/studio — cost: rename later.
Ruling: execute builds the fallback version and finishes; each approved generate task is its own executor dispatch that writes the asset and swaps it into comp/ — avoids an agent blocked on human approval — cost if wrong: extra dispatches per gen item.

## Progress
Task 1: complete (commits ef87128..77a5724, review clean)
Task 1: minor (deferred): no dev:studio script — add in Task 8
Task 1: minor (deferred): projectDir/styleDir no id sanitising (../ escape) — Ruling: fix in Task 4 (ids arrive over HTTP there) by rejecting ids not matching /^[a-z0-9-]+$/ in paths.ts — cost if wrong: none
Task 1: minor (deferred): writeJson no fsync; listProjects swallows corrupt project.json silently; tests don't restore env/remove temp dirs; style.json 2KB bound unenforced
Task 2: review 1 = Needs fixes (Important: no lock heartbeat/owner token -> long tasks double-run; concurrent stale reclaim double-win)
Task 2: minor (deferred): mutex has no owner token (>30s holder); crash between tryLock and mark-running wedges a queued task forever; listTasks skips unreadable files (Windows EPERM/EBUSY) so exclusive check can miss; no child_process cross-process test; stray test comment queue.test.ts:114; one test outside describe
Ruling: Task 5 MCP server keeps claim tokens in memory keyed by taskId and passes them to progress/finish/fail — token is optional in queue API for compatibility — cost if wrong: a tokenless caller loses ownership protection
Task 2: fix round 1/5 (2 addressed, 0 open; commits fd4bc38..86ffb1c)
Task 2: re-review Important "token optional, callers must pass it" — covered by Task 5 ruling above (MCP passes tokens); carried into Task 5 dispatch
Task 2: minor (deferred): assertOwner->update not atomic (tiny window); mutex shared by fresh and stale paths
Task 2: complete (commits 77a5724..86ffb1c, review clean)
Task 3: review 1 = Needs fixes (Important: partial patch wipes stored key)
Ruling: Task 3 fix also adds optional writeJson mode param so config.json is 0600 before rename — file holds API keys — cost if wrong: one extra optional param
Task 3: minor (deferred): botUrl/port cannot be cleared; tests use `as never` casts; no test for masked save with no old key
Task 3: fix round 1/5 (2 addressed, 0 open; commits 718b85c..313a2ba)
Task 3: complete (commits 86ffb1c..313a2ba, review clean)
Task 4: review 1 = Needs fixes (Important: same-name upload race deletes in-progress .part; reproduced)
Ruling: Task 4 fix also decodes x-filename (client sends encodeURIComponent) + Windows/length filename rules — Uzbek names and Windows target — cost if wrong: stricter names rejected
Ruling: Task 4 fix restricts chat `files` to existing broll/refs basenames — agents read them — cost: none
Task 4: minor (deferred): bad-id 400 chosen by message prefix (use error class); no Host header check (DNS rebinding, static only); 413 mid-stream client may not see it, no cap test; watcher error ignored / no SSE backpressure
Task 4: parked — reviewer #9 execute/render posted straight to queued — Ruling: per plan Task 9 the Studio posts execute only after the user's plan Approve click, render only on the Render button; the approve endpoint is for generate tasks — cost if wrong: none
Task 4: fix round 1/5 (5 addressed, 0 open; commits 786773c..cfa6314)
Task 4: minor (deferred): fs.link fails on FAT/exFAT/some network mounts (add rename fallback); stale .part never cleaned; unlink-after-link failure returns 500; findAsset follows symlinks; trailing dot/space names not rejected
Task 4: complete (commits 313a2ba..cfa6314, review clean)
Ruling: Task 5 skips plan Step 5 (manual Claude Code MCP timeout measurement) — moved to Task 12 E2E (needs a real Claude Code session) — cost if wrong: 240 s default may exceed the MCP timeout until E2E
Ruling: next_task refreshes home()/heartbeat every 30 s while waiting — keeps Studio pill green during long poll — cost: none
Ruling: doctor ok = node && ffmpeg && hyperframes; yt-dlp optional — raw upload covers missing yt-dlp — cost: IG links fail with a clear message
Task 5: review 1 = Needs fixes (Important: taskId path traversal at MCP/queue boundary)
Ruling: Task 5 fix adds AbortSignal to waitForTask, wired to MCP extra.signal — cancelled long polls must not claim tasks — cost: none
Task 5: minor (deferred): entry check fails via symlinked bin shim (use realpathSync if bin added)
Task 5: fix round 1/5 (3 addressed, 1 open — post-abort write-back lacks owner check/try-finally; commits 88142d3..7a27f31)
Task 5: fix round 2/5 (1 addressed, 0 open; commits 7a27f31..f209f65)
Task 5: minor (deferred): requeueClaim swallows errors (failed update leaves running w/o lock until stale recovery)
Task 5: complete (commits cfa6314..f209f65, review clean)
Ruling: Task 6 adds POST /api/projects/:id/refs/file for uploaded raw refs (plan only covered URL refs) — spec §9 allows raw ref drops — cost: none
Ruling: Task 6 ref routes await download+sheet synchronously (no background job) — simplest; Node requestTimeout 300 s — cost if wrong: very long downloads time out; move to background later
Task 6: review 1 = Needs fixes (Important: no `--` before URL; printed path not confined to refs/; extension not allow-listed)
Task 6: minor (deferred): a.mp4 and a.mov share a.sheet dir; pts_time regex accepts negatives
Task 6: fix round 1/5 (5 addressed, 0 open; commits 98ec072..1ca7c28)
Task 6: minor (deferred): add yt-dlp --no-mtime (fallback mtime check); no test for refsheet duration error; media imports server/upload (move ALLOWED_EXTS to core); concurrent downloads can cross-pick in fallback
Task 6: complete (commits f209f65..1ca7c28, review clean)
Ruling: Task 7 adds MCP tool request_generation (executor needs a way to create awaiting_approval generate tasks; plan omitted it) — cost: none
Ruling: generate tool's approval proof = task type generate AND status running (only reachable via approve+claim since Studio cannot POST generate) — cost if wrong: a hand-edited task file could bypass approval
Ruling: bot default URL https://api.motionable.uz is a placeholder until part B exists — cost: bot path unusable until set
Task 7: open (needs real check): kie createTask path + nano-banana-2/pro + kling ids UNVERIFIED; prices.json placeholders; bot STT shape assumed (part B must match)
Task 7: review 1 = Needs fixes (Important: double spend via retry/concurrency/timeout; executed provider/price not bound to approval)
Ruling: transcribe (STT) runs without a per-call Approve — enabling an STT provider in Settings is the consent; cost ~$0.004/min — Settings UI must say so (Task 8) — cost if wrong: small unapproved STT spend
Ruling: Task 7 fix also replaces default bot URL with https://bot.invalid + https-only botUrl, redirect-safe downloads, project-relative wordsPath — key leak/SSRF risk — cost: none
Task 7: minor (deferred): bot transcribe words fetch uncapped; whole media read into memory for STT (add size limit/extract audio); TTS write not .part+rename and uncapped; adapter request-shape asserts weak (bot body, kie input/auth/recordInfo, Veo path, ElevenLabs fields); generate not tied to claim token; gen.log appendFile w/o zod (document)
Task 7: fix round 1/5 (5 addressed, 1 new open — marker unlinked after ambiguous create failure; commits e240ce2..f941498)
Task 7: minor (deferred): concurrent resumes share .part/duplicate log line; isTransient treats all TypeErrors transient; refused redirect body not cancelled; provider check compares only `use` (not key/botUrl); old tasks without input.provider always provider_changed; bot transcribe has no idempotency key
Task 7: fix round 2/5 (1 addressed, 0 open; commits f941498..66fe98f)
Task 7: minor (deferred): adapters without onCreateAttempt (ElevenLabs TTS via generate) still unlink marker on post-send error -> possible double TTS charge (cents); no documented manual recovery for unknown_job_state marker
Task 7: complete (commits 1ca7c28..66fe98f, review clean)
Ruling: Task 8 excludes studio/ from root tsc instead of adding @types/react-dom (not in user-approved dep list) — cost if wrong: SPA not type-checked; ask user to approve @types/react-dom later
Ruling: Task 8 uses opus implementer (UI judgment) — cost: higher tokens for one task
Ruling: study_ref styleId assigned by the server at task creation (input.styleId = slug of ref basename + suffix); ref-study writes styles/<styleId>/style.json; References sends styleIds from task.input.styleId — carry into Task 9 (modify refs routes + References.tsx) — cost: none
Task 8: review 1 = Needs fixes (Important: token stays in URL; References stale state across projects; no SSE resync on reconnect)
Task 8: minor (deferred): Onboarding retry doesn't auto-route, zero files allowed, aria-invalid by string compare; raw server error codes untranslated; orphan refs file when refs/file POST fails; loadProjects never retried
Task 8: fix round 1/5 (4 addressed, 0 open; commits dc3e0a8..78cc382)
Task 8: minor (deferred): botUrl cannot be cleared from UI; SSE ?t= token may appear in logs; no DOM tests for stale-state/reconnect fixes
Task 8: complete (commits 66fe98f..78cc382, review clean)
Ruling: Task 9 adds POST tasks/:tid/decline (generate + awaiting_approval only -> fail 'declined') — plan said reject = fail but no route existed — cost: none
Task 9: minor (deferred): no server guard against a second active execute task (409); decline check+fail not atomic, approve returns 200 on non-awaiting task (should 409); failed execute hides PlanReview with no retry; References may send styleIds never saved by the agent; unknown-state banner never clears
Task 9: complete (commits 78cc382..1437626, review clean)
Task 10: open (needs real check): hyperframes preview flags (--foreground --port, BROWSER=none) unverified against real CLI — verify in Task 12 E2E
Task 10: review 1 = Needs fixes (Important: preview kill no SIGKILL escalation; group not killed on unexpected exit)
Task 10: minor (deferred): stale preview URL after child dies (no iframe-error reload); multi-range returns 416 (could 200); freePort TOCTOU; preview effect keyed on hasExecute only; preview/renders routes skip getProject
Task 10: fix round 1/5 (3 addressed, 0 open; commits 0450f1e..753395b)
Task 10: minor (deferred): child env inherits process.env (API keys) and 2KB tail may echo it — redact/strip; win32 success path doesn't sweep descendants
Task 10: complete (commits 1437626..753395b, review clean)
Ruling: agent models ref-study=sonnet, director=opus, executor=sonnet — plan quality vs token cost — cost if wrong: higher/lower quality or spend
Ruling: leave user's stale ~/.claude/skills/motionable symlink (-> repo skills/motionable) and global MCP "motionable" (old tsx path) untouched; report to user at finish — user config — cost: duplicate/conflicting skill + failing MCP entry until user removes them
Ruling: dist/ stays gitignored; installer (Task 12) runs npm ci + build so .mcp.json's dist/mcp.js exists — cost if wrong: marketplace install without installer has no MCP server
Task 11: review 1 = Needs fixes (Important: heartbeat stale during long tasks; subagent permission prompts; executor never checks against reference (slop risk); no ban on other paid paths; dist not self-contained)
Ruling: transcribe pre-approved once STT provider enabled — spec/plan text updated in fix round — cost: small unapproved STT spend
Ruling: tsup bundles all deps (noExternal) so plugin runs without node_modules; committing dist decided in Task 12 — cost: larger dist
Task 11: minor (deferred): PlanSchema doesn't enforce contiguous scenes / footage in-out within clip / duration = last end; executor copies footage into comp/assets (duplicate size); hyperframes skills are user-level (doctor/install hint needed); root .mcp.json read as project MCP in dev sessions
Task 11: fix round 1/5 (8 addressed, 0 open; commits e3b3789..5b0019a)
Task 11: minor (deferred): createRequire banner could clash with a bundled top-level require; cliPath dev/test path assumes basename 'mcp'
Task 11: complete (commits 753395b..5b0019a, review clean)
Ruling: Task 12 installer tested only under a temp HOME (no changes to user's real ~ or ~/.claude); e2e checklist written but not run (needs user consent) — cost: real-home install and E2E still unverified
Task 12: review 1 = Needs fixes (Critical: downloaded binaries not checksum-verified; Important: stale app files, bin PATH shadows system tools, stale yt-dlp, evermeet failure message, doctor failure reported as success)
Task 12: minor (deferred): tar ./ excludes untested on macOS bsdtar; skillsMissing checks only ~/.claude/skills; e2e step 12 tie to preview.ts flags
Ruling: accept macOS ffmpeg source switch to ffmpeg.martin-riedl.de (publishes per-file sha256; evermeet has none) — cost if wrong: different third-party binary source on macOS, untested on a real Mac
Task 12: fix round 1/5 (6 addressed, 1 open — English README no-keys order; new: --retry-all-errors needs curl>=7.71; commits 1946da5..a6fef3a)
Task 12: minor (deferred): hashes come from same host as binaries (corruption guard only); Linux ffmpeg only md5; ps1 Invoke-WebRequest may follow https->http redirect (hash still guards); wipe-before-copy leaves broken app if copy fails mid-way
Task 12: fix round 2/5 (5 addressed, 0 open; commits a6fef3a..f8b0e75)
Task 12: minor (deferred): GET downloads have no --max-time (curl --retry only)
Task 12: complete (commits 5b0019a..f8b0e75, review clean)
Final review: With fixes — Critical win32 doctor; Important win32 preview, readPlan, failed-execute dead end, failed-ref block, no nav back, chat no replies, tts no consumer. Fix wave dispatched (final-findings.md).
Final fix wave: 12 addressed, 0 open (commits f8b0e75..a1aa12d). Minor: Pipeline hint flash before load; execute 409 check not atomic, awaiting_approval execute not blocked
