# Motionable

A local studio + MCP server: the user's own Claude Code edits talking-head footage into reels in the user's own
style. Claude directs over MCP; the Studio (a web page served by the local daemon) is the visual side.

## Layout
- `packages/plan`: the edit plan (`edit-plan.json`), ops, validation, lessons. The plan is the only source of truth.
- `packages/compose`: plan → HyperFrames page. `packages/engine`: ffmpeg, face track (YuNet, WASM), transcription.
- `packages/gate`: checks every component a style writes. `apps/daemon`: HTTP API + live events + page builds.
- `apps/mcp`: the MCP shim Claude Code talks to. `apps/studio`: the Studio (React + Vite). `skills/motionable`: the skill.

## Decisions
- Engine: **HyperFrames** (Apache-2.0). HTML is generated from the plan, never hand-edited.
- No built-in styles: every user builds their own from reference reels (Styles → Claude studies them).
- No Anthropic API key: Claude Code is the director. Paid services (ElevenLabs) run on the user's own key.
- UI in Uzbek and English.

## Rules
1. A style exists only after its references are studied. No edit without a style.
2. Mistakes are remembered: every rejection becomes a lesson, enforced by the validator where possible.
3. Keep every `.md` short: SKILL.md ≤120 lines, references ≤60, lessons ≤5.
4. Minimise tokens: compact JSON tool results, diffs not full plans, images only on request, scripts do the maths.
5. Ask before installing packages and before every paid API call.
6. Only code under compatible licences (MIT, Apache-2.0, BSD); keep their notices in THIRD_PARTY_NOTICES.md.
