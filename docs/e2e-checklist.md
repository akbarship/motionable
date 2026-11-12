# Motionable end-to-end checklist

Run only with the user's consent - uses their Claude subscription and, for generation, paid credits.

Tick each step. Note anything that surprises you.

## A. No keys

1. Run the installer (`scripts/install.sh` or `scripts/install.ps1`). `doctor` prints `"ok": true`.
2. Run the two printed `claude plugin ...` commands, restart Claude Code, then run `/motionable:motionable`.
3. Onboarding finishes (Studio opens in the browser, folder and settings are created).
4. Add one Instagram link and one raw reference video.
5. Style becomes ready (ref-study agent finishes, style shows in Studio).
6. Create a project with footage; the director plan appears.
7. Approve the plan without generation (no paid calls listed).
8. Preview loads in the Studio.
9. Send two chat edits; each updates the preview.
10. Render. The mp4 plays and its duration matches the plan within one frame.

## B. Timing and preview measurements

11. Measure Claude Code's MCP tool timeout against `MOTIONABLE_WAIT_S=240`: let `next_task` wait with an empty queue and record when Claude Code gives up. If it is shorter than 240 s, lower the default in `src/mcp/server.ts`.
12. Verify the real `hyperframes preview` flags: run `npx hyperframes preview --help`; confirm `--foreground` and `--port` exist and are what `src/server/preview.ts` passes.
13. Confirm `BROWSER=none` is set for the preview child and that no extra browser tab opens besides the Studio.

## C. With an STT key

14. Enable an STT provider in Settings and add its key.
15. Repeat steps 6-10; captions appear, word timings are plausible, STT ran once (about $0.004/min).

## D. Generation (costs money - ask the user first)

16. Ask the user for approval and a kie.ai key.
17. Run one small generation; the cost quote shows in the Studio.
18. Press Approve; confirm the final cost is within the approved amount and the asset lands in the project.
19. Render again; the generated asset is in the mp4.
