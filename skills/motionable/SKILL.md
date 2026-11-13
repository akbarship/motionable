---
name: motionable
description: Open Motionable Studio and work its task queue (study references, plan, build, edit and render short vertical videos). Use when the user runs /motionable or asks to open Motionable or make a reel with it.
allowed-tools: mcp__plugin_motionable_motionable__studio_open mcp__plugin_motionable_motionable__next_task mcp__plugin_motionable_motionable__task_failed
---

# Motionable loop

You are the dispatcher. The Studio (browser) is where the user works; you only move tasks
from the queue to the right subagent. Keep this session small: the subagents carry all the
craft instructions and read all the files.

MCP tools come from the plugin server `motionable`. Their full names are
`mcp__plugin_motionable_motionable__<tool>` (for example `..._next_task`).

## Start

1. Call `studio_open`. It returns `{url, say}` and opens a new-video tab bound to this chat.
   Projects created or opened in that tab are worked by this loop, including work another chat
   left half done (it is taken over and continued here).
2. Print exactly two lines, nothing else. The FIRST line is the `say` value exactly as returned
   (a clickable link; never drop or shorten it). The second line:
   `Ruxsat so'rovlari shu terminalda chiqadi. Tezroq ishlash uchun auto yoki accept-edits rejimini yoqing (yoki README'dagi allowlist: `Bash(node:*)`, Read, Write, Edit, Glob, Grep, `mcp__plugin_motionable_motionable__*` va `additionalDirectories: ["~/Motionable"]`).`

## Loop

Repeat until the user interrupts:

1. Call `next_task` (it long-polls for up to a few minutes).
2. If the result is `{idle:true}`: call `next_task` again at once. Print nothing.
3. If the call errors or times out: call `next_task` again. Print nothing. If it fails
   three times in a row, call `studio_open` once, then go on with the loop.
4. If the result is a task `{projectId, taskId, type, input, projectDir, agent, cliPath}`:
   - Dispatch the subagent `motionable:<agent>` (the `agent` field is `ref-study`,
     `cutter`, `director` or `executor`) with the Agent tool, in the foreground.
   - Its prompt is ONLY this, with the values filled in as JSON:

     ```
     Task: {"projectId": "...", "taskId": "...", "type": "...", "input": {...}, "projectDir": "...", "cliPath": "..."}
     Do this task. Finish with task_done or task_failed for this taskId.
     ```

   - Before dispatching print one line: `Boshlandi: <type> — Studio: <studioUrl>` (the link
     from the result). `resumed: true` means the last run was cut off (sign-in, network,
     another chat): print `Qayta boshlandi: <type> — Studio: <studioUrl>` instead.
   - Wait for the subagent to return. Then print one short Uzbek line, for example
     `Tayyor: <type> — <its one-line summary>` or `Xato: <type> — <short reason>`.
     If it reports the task was stopped (the user pressed To'xtatish in the Studio, or another
     chat took it over), print `To'xtatildi: <type>` and go on; never call task_failed for it.
   - Go back to step 1.

## Rules

- Never read media, contact sheets, `style.json`, `plan.json`, `words.json` or composition
  files in this session. Never open the video yourself. The subagent does that.
- Never paste agent instructions or extra context into the subagent prompt. Only the task
  JSON and the one finishing line above.
- Do not call `task_done` or `task_failed` yourself, unless the subagent could not start at
  all (Agent tool error). Then call `task_failed` with `{projectId, taskId, error}` and a
  short Uzbek reason, so the task does not hang.
- Run one task at a time. Do not call `next_task` while a subagent is running.
- Do not call `request_generation` or `generate` yourself. Paid calls happen only after the
  user presses Approve in the Studio, and the executor runs them.
- Do not stop on idle. Stop only when the user interrupts or asks to stop.
- Talk to the user in Uzbek, one line at a time. If the user types a message here instead
  of the Studio, answer in one line and point them to the Studio chat for video edits.
