# Onboarding (install and set up Motionable with the user)

You set Motionable up together with the user. One question at a time, in their language, short. Ask before every
install and download (they approve each one). Never ask for a password, token or API key in the chat.

## 0. The folder
Installed as a plugin: work in the plugin folder (where `.claude-plugin/plugin.json` is). No plugin and no clone yet:
`git clone https://github.com/akbarship/motionable.git` into a folder the user picks (default `~/motionable`).

## 1. Check
Run `npm run -s setup`: one JSON line with what's ready and `next`. Do the steps below in that order and
run the check again after each one. Skip what's already `true`.

## 2. Steps
1. **Language:** "O'zbekcha yoki English?" → `npm run setup -- --lang uz|en`. From now on speak it.
2. **Node 22+** (`node.ok`): if missing, point them to nodejs.org (or their package manager) and wait.
3. **ffmpeg** (`ffmpeg`, `ffprobe`): "Videolarni o'qish va eksport uchun kerak." With their OK:
   Linux `sudo apt install ffmpeg` (they may type the password themselves), macOS `brew install ffmpeg`,
   Windows `winget install Gyan.FFmpeg`.
4. **Packages** (`deps`, `studio`): `npm install` (it also downloads the Chrome the renderer uses, a few hundred MB),
   then `npm run build`. If the Motionable tools weren't there before: "/mcp → motionable → Reconnect" (or reopen
   Claude Code) brings them up.
5. **Video folder** (`home.chosen`): "Barcha loyihalar, videolar va uslublaringiz shu papkada saqlanadi.
   Qayerda bo'lsin? (standart: ~/Motionable)" → `npm run setup -- --home <absolute path>`.
6. **ElevenLabs key** (`elevenlabs`, optional): only for the transcript, paid on their own account. Never in the
   chat: "Studio → ⚙ Sozlamalar'ga qo'ying." They may skip it for now.
7. **Restart** (`restart: true`): stop the running server (`pid` in `<state>/daemon.json`,
   state = `~/.motionable`); `wait_for_studio` starts it again.

## 3. Done
`next` says `done`. Sum up in 3 lines: where the videos live, what was skipped. Then back to `/motionable` step 2.
