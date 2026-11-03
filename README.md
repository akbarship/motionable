# Motionable

**Edit talking-head footage into reels in your own style.** Your own Claude Code is the editor: it cuts retakes
and fillers, writes captions, places titles, b-roll, transitions and sound. Motionable is the studio on your
computer where you watch the edit, fix it by hand, leave notes for Claude, and export.

Free and open source (MIT). [O'zbekcha](README.uz.md)

- **Your style, not a template.** Upload 2–3 reels you like; Claude studies them and builds your design system:
  colours, type, caption system, pacing, components. Every value says where it came from.
- **A plan before the edit.** Say what the video is about, pick a format and a style, add your files: Claude writes a
  scene-by-scene plan with the reason for each choice. It edits only after you approve it.
- **Voiceover motion.** No footage? A voice track becomes a reel made of motion and b-roll.
- **Edit by text.** A timestamped transcript: click a word to jump there, select words to cut them.
- **Notes at a moment.** "Make this cut faster" at 00:11.8 → Claude fixes it and replies.
- **It remembers.** Say "not this" once and it becomes a lesson; the same mistake is refused next time.
- **Captions never cover the face.** A face tracker keeps text off it.
- **Export** for reels: MP4 at −14 LUFS plus an SRT.

## Requirements
- **[Claude Code](https://claude.com/claude-code)** with a Claude plan (terminal, desktop app or IDE)
- Windows 10/11, macOS (Intel or Apple silicon) or Linux. The installer brings Node.js and ffmpeg itself.
- Optional keys, in the Studio's ⚙ Settings: **ElevenLabs** for the transcript (paid, your own account; asked before
  every call), **Pexels** and **Pixabay** (free) for stock b-roll.

## Install
One line in a terminal. No admin rights; run it again to update.

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.sh | bash
```
**Windows** (PowerShell)
```powershell
irm https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.ps1 | iex
```
It installs into `~/.motionable/app`, asks your language and where your videos live, and connects Claude Code.
Then open Claude Code and type **`/motionable`**: the Studio opens.

**As a Claude Code plugin:** `/plugin marketplace add akbarship/motionable`, `/plugin install motionable`, then
`/motionable`: Claude sets the rest up with you, one question at a time, and asks before installing anything.

## Your first video
1. **`/motionable`** in Claude Code. The Studio opens; the pill says *Claude connected*: Claude is waiting for it.
2. **+ New video:** what it is about (and the script, if you have one), the format (*Edit* or *Voiceover
   motion*) and a style. No style yet? Upload 2–3 reels you like: Claude builds one while you carry on.
3. **Materials:** your footage (or the voice track), b-roll, images, music. Agree to the transcript (paid,
   ElevenLabs) and press *Send to Claude*.
4. **The plan:** length, what gets cut, every scene with what happens and why. *Approve* or say what to change.
5. Claude edits; watch it in the Studio. Fix by hand (Elements: nudge, remove, "not this") or leave **notes** and
   *Send to Claude*. **Export**, then find it under **My videos**.

Claude works in your own chat session, on your own Claude plan; you see each step there. Press Esc to talk to it,
then it goes back to waiting for the Studio.

## Where things live
`~/Motionable` holds your projects and styles; `~/.motionable` your settings, keys and lessons. Nothing is
uploaded anywhere except the audio you send to ElevenLabs for transcription.

The server listens on `127.0.0.1` only and answers only requests addressed to this computer, so other websites
can't reach it. Don't expose port 4377 to a network.

## Development
`npm run dev` (Studio with hot reload, next to `npm start`), `npm test`, `npm run typecheck`.
Architecture and rules: [CLAUDE.md](CLAUDE.md). Components: [docs/v2/components.md](docs/v2/components.md).

## Support the project
Motionable is free. If it saves you time, you can support its development:

<!-- DONATE: the maintainer's donation details go here -->

## License
MIT. Third-party parts: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
