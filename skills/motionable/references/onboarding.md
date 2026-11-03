# Onboarding (install and set up Motionable with the user)

You set Motionable up together with the user. One question at a time, in their language, short. Ask before every
install and download (they approve each one). Never ask for a password, token or API key in the chat.

## 0. The folder
- Installed with the one-line installer: `~/.motionable/app` (Windows: `%USERPROFILE%\.motionable\app`).
- Installed as a plugin: the plugin folder (where `.claude-plugin/plugin.json` is).
- Neither: offer the installer. The user pastes it in their own terminal:
  macOS/Linux `curl -fsSL https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.sh | bash`,
  Windows (PowerShell) `irm https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.ps1 | iex`.
  It brings Node and ffmpeg without admin rights, installs, builds and connects Claude Code. Then they reopen Claude.

## 1. Check
Run `npm run -s setup`: one JSON line with what's ready and `next`. Do the steps below in that order and
run the check again after each one. Skip what's already `true`.

## 2. Steps
1. **Language:** "O'zbekcha yoki English?" → `npm run setup -- --lang uz|en`. From now on speak it.
2. **Node 22+** (`node.ok`): missing → the installer above brings its own; or nodejs.org.
3. **ffmpeg** (`ffmpeg`, `ffprobe`): "Videolarni o'qish va eksport uchun kerak (~80 MB)." With their OK:
   `npm run setup -- --ffmpeg` (downloads a static build into `~/.motionable/bin`, no admin rights, every OS).
4. **Packages** (`deps`, `studio`): `npm install` (it also downloads the Chrome the renderer uses, a few hundred MB),
   then `npm run build`. If the Motionable tools weren't there before: "/mcp → motionable → Reconnect" (or reopen
   Claude Code) brings them up.
5. **Video folder** (`home.chosen`): "Barcha loyihalar, videolar va uslublaringiz shu papkada saqlanadi.
   Qayerda bo'lsin? (standart: ~/Motionable)" → `npm run setup -- --home <absolute path>`.
6. **Chrome libraries** (`chromeLibs` not empty, Linux only): the user runs, in their own terminal,
   `sudo npx puppeteer browsers install chrome-headless-shell --install-deps` (it asks for their password).
7. **Restart** (`restart: true`): `npm run setup -- --restart`.
8. **Keys** (optional, never in the chat: "Studio → ⚙ Sozlamalar'ga qo'ying"): ElevenLabs for the transcript (paid,
   their own account); Pexels and Pixabay (free) for stock b-roll. They may skip them for now.

## 3. Done
`next` says `done`. Sum up in 3 lines: where the videos live, what was skipped. Then back to `/motionable` step 2.
Updates later: `npm run update` (or the installer again).
