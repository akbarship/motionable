# Motionable

**Edit talking-head footage into reels in your own style.** Your own Claude Code is the editor: it cuts retakes
and fillers, writes captions, places titles, b-roll, transitions and sound. Motionable is the studio on your
computer where you watch the edit, fix it by hand, leave notes for Claude, and export.

Free and open source (MIT). [O'zbekcha](README.uz.md)

- **Your style, not a template.** Upload 2–3 reels you like; Claude studies them and builds your design system:
  colours, type, caption system, pacing, components. Every value says where it came from.
- **Edit by text.** A timestamped transcript: click a word to jump there, select words to cut them.
- **Notes at a moment.** "Make this cut faster" at 00:11.8 → Claude fixes it and replies.
- **It remembers.** Say "not this" once and it becomes a lesson; the same mistake is refused next time.
- **Captions never cover the face.** A face tracker keeps text off it.
- **Export** for reels: MP4 at −14 LUFS plus an SRT.

## Requirements
- **Node.js 22+** and **ffmpeg** (with `ffprobe`) on your PATH
- **[Claude Code](https://claude.com/claude-code)** with a Claude plan
- An **ElevenLabs** API key for transcription (paid, on your own account; asked before every call)
- Tested on Ubuntu 24.04 with Chrome. macOS and Windows are not tested yet: reports and fixes are welcome.

## Install
```bash
git clone <this repo> motionable
cd motionable
npm install          # also downloads the Chrome the renderer uses
npm run build        # builds the Studio
npm start            # the local server: http://127.0.0.1:4377
```
Open **http://127.0.0.1:4377** in Chrome. Then connect Claude Code (once):
```bash
npm run connect      # adds the motionable MCP server and skill to your Claude Code
```
(Or just open `claude` inside this folder: it picks them up from here.) Put your ElevenLabs key in ⚙ Settings.

## Your first video
1. **Styles → new style:** upload 2–3 reference reels, copy the prompt into Claude Code. Claude studies them,
   saves the style and writes its components; each one passes a check before it's used. Look at the specimen.
2. **+ New project:** choose your video(s). The free analysis runs; then the transcript (paid, you confirm),
   then pick a style and a camera.
3. In Claude Code: *"Edit Motionable project &lt;name&gt; in my style."* Watch it change in the Studio.
4. Fix by hand (cut words, drag titles, change a caption line) or leave **notes** and press *Send to Claude*.
5. **Export.** Find it under **My videos**.

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
