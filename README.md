# Motionable

## O'zbekcha

Motionable - Claude Code uchun bepul (MIT) plagin. U namunaviy videolaringiz va o'z kadrlaringizdan qisqa vertikal videolar (reels) yasaydi. Brauzerda ochiladigan lokal Studio, MCP server va uchta agent bilan ishlaydi.

### O'rnatish

Avval Node.js 22 yoki yangisini o'rnating: https://nodejs.org. Keyin repozitoriyni yuklab oling va bitta buyruq bajaring.

Linux / macOS:

```bash
bash scripts/install.sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Skript ffmpeg va yt-dlp'ni (agar yo'q bo'lsa) `~/.motionable/bin` ga yuklaydi, ilovani `~/.motionable/app` ga nusxalaydi, quradi va oxirida Claude Code'da bajariladigan ikki buyruqni chiqaradi:

```
claude plugin marketplace add "<~/.motionable/app>"
claude plugin install motionable@motionable
```

Administrator huquqi (sudo) kerak emas. Skriptni qayta ishga tushirish xavfsiz.

### Boshlash

Claude Code'ni qayta ishga tushiring va yozing:

```
/motionable:motionable
```

### Kalitlarsiz nima ishlaydi

Kalitsiz ham butun jarayon ishlaydi: namuna tahlili, uslub, rejissyor rejasi, preview, chat orqali tahrir va render. Faqat AI generatsiya (rasm/video) o'chiq turadi. Subtitr (caption) uchun so'zlar vaqti kerak: STT provayderi yoki o'zingiz yopishtirgan matn bo'lsa ishlaydi.

### Kalitlar

Ikki yo'l bor:

- O'z kalitlaringiz: kie.ai (rasm/video), ElevenLabs (subtitr/ovoz). Kalitlarni Studio'dagi Settings'ga kiritasiz.
- Bot orqali: tez orada.

Pullik chaqiruvlar Studio'da Approve bosganingizdan keyingina bajariladi. Istisno: STT yoqilgandan keyin bir marta avtomatik ishlaydi (taxminan $0.004/daqiqa).

### Ruxsatlar / Permissions

Agentlar ko'p buyruq bajaradi, shuning uchun Claude Code har safar ruxsat so'raydi. Tezlashtirish uchun loyiha papkangizdagi `.claude/settings.json` ga qo'shing:

```json
{
  "permissions": {
    "allow": [
      "Bash(npx hyperframes:*)",
      "Bash(node:*)",
      "Bash(ffprobe:*)",
      "Bash(ffmpeg:*)",
      "Read",
      "Write",
      "Edit",
      "mcp__plugin_motionable_motionable__*"
    ]
  }
}
```

Yoki Claude Code'ni auto / accept-edits rejimida ishga tushiring.

### HyperFrames skill'lari

Agentlar `hyperframes`, `hyperframes-cli` va `hyperframes-registry` skill'laridan foydalanadi. O'rnatish: `npx hyperframes skills`. Agar bu ishlamasa: `npx skills add heygen-com/hyperframes --all`. `node dist/cli.js doctor` natijasidagi `skillsMissing` ro'yxati yetishmayotganlarini ko'rsatadi.

### Muammolarni hal qilish

```bash
node ~/.motionable/app/dist/cli.js doctor
```

`"ok": true` bo'lishi kerak. `ffmpeg` yoki `hyperframes` `false` bo'lsa, o'rnatish skriptini qayta ishga tushiring. Windows'da yo'l: `node %USERPROFILE%\.motionable\app\dist\cli.js doctor`. `ytdlp` `false` bo'lsa, faqat Instagram havolasi bilan ishlash o'chadi; o'z faylingizni berishingiz mumkin.

### Litsenziya

MIT.

---

## English

Motionable is a free (MIT) Claude Code plugin that makes short vertical videos (reels) from your reference videos and your own footage. It runs a local browser Studio, an MCP server and three agents.

### Install

Install Node.js 22 or newer first: https://nodejs.org. Then clone this repo and run one command.

Linux / macOS:

```bash
bash scripts/install.sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The script downloads ffmpeg and yt-dlp into `~/.motionable/bin` if missing, copies the app to `~/.motionable/app`, builds it, and prints the two Claude Code commands to run (`claude plugin marketplace add ...` and `claude plugin install motionable@motionable`). No sudo or admin rights. Safe to re-run.

### Start

Restart Claude Code and run `/motionable:motionable`.

### What works with no keys

The full pipeline works without keys: reference study, style, director plan, preview, chat edits and render. Only AI generation (image/video) is off. Captions need word timings: an STT provider, or a script you paste.

### Keys

- Your own: kie.ai (image/video), ElevenLabs (subtitles/voice), entered in Studio Settings.
- Or the bot: coming soon.

Paid calls need Approve in the Studio. The exception is STT, which runs on its own once enabled (about $0.004/min).

### Permissions

See the `.claude/settings.json` allowlist in the Uzbek section above. `mcp__plugin_motionable_motionable__*` is the supported wildcard form for all tools of this plugin's MCP server.

### HyperFrames skills

Agents use the `hyperframes`, `hyperframes-cli` and `hyperframes-registry` skills. Install with `npx hyperframes skills`; if that is unavailable, `npx skills add heygen-com/hyperframes --all`. `doctor` lists missing ones under `skillsMissing`.

### Troubleshooting

Run `node ~/.motionable/app/dist/cli.js doctor`. Expect `"ok": true`. If `ffmpeg` or `hyperframes` is `false`, re-run the installer. If `ytdlp` is `false`, Instagram links will not download; you can still use your own files.

### License

MIT.
