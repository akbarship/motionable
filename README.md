# Motionable (plagin)

> Bu `plugin` branchi: Claude Code plagini (Studio, MCP server, agentlar). Yangi va yengilroq yo'l `main` branchida: [PDF qo'llanma va 4 ta prompt](https://github.com/akbarship/motionable).
>
> This is the `plugin` branch: the Claude Code plugin (Studio, MCP server, agents). The newer, lighter path lives on `main`: [a PDF guide and 4 prompts](https://github.com/akbarship/motionable).

## O'zbekcha

Motionable - Claude Code uchun bepul (MIT) plagin. U namunaviy videolaringiz va o'z kadrlaringizdan qisqa vertikal videolar (reels) yasaydi. Brauzerda ochiladigan lokal Studio, MCP server va uchta agent bilan ishlaydi.

### O'rnatish

Avval Node.js 22 yoki yangisini o'rnating: https://nodejs.org. Keyin repozitoriyni yuklab oling va bitta buyruq bajaring.

Linux / macOS:

```bash
git clone -b plugin https://github.com/akbarship/motionable.git
cd motionable
bash scripts/install.sh
```

Windows (PowerShell):

```powershell
git clone -b plugin https://github.com/akbarship/motionable.git
cd motionable
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Skript ffmpeg va yt-dlp'ni (agar yo'q bo'lsa) `~/.motionable/bin` ga yuklaydi (har bir fayl e'lon qilingan nazorat yig'indisi bilan tekshiriladi), ilovani `~/.motionable/app` ga nusxalaydi, quradi va oxirida Claude Code'da bajariladigan ikki buyruqni chiqaradi:

```
claude plugin marketplace add "$HOME/.motionable/app"
claude plugin install motionable@motionable
```

Administrator huquqi (sudo) kerak emas. Skriptni qayta ishga tushirish xavfsiz.

### Boshlash

Claude Code'ni qayta ishga tushiring va yozing:

```
/motionable:motionable
```

### Saboqlar

Storyboard yoki chatda qoldirgan izohingiz umumiy qoida bo'lsa, u saboq sifatida saqlanadi (`~/Motionable/lessons.md`, uslubga xosi `~/Motionable/styles/<id>/lessons.md`). Har bir keyingi video shu qoidalar bilan rejalashtiriladi. Sozlamalar sahifasida saboqlarni ko'rasiz, qo'lda qo'shasiz va noto'g'risini o'chirasiz.

### Kalitlarsiz nima ishlaydi

Kalitsiz ham deyarli butun jarayon ishlaydi. Istisno: subtitr (caption) so'zlar vaqtini talab qiladi, shuning uchun STT provayderi yoki o'zingiz yopishtirgan matn kerak. Qolgan hammasi kalitsiz ishlaydi: namuna tahlili, uslub, rejissyor rejasi, preview, chat orqali tahrir va render. Faqat AI generatsiya (rasm/video) o'chiq turadi.

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
      "Bash(node:*)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "mcp__plugin_motionable_motionable__*"
    ],
    "additionalDirectories": ["~/Motionable"]
  }
}
```

`additionalDirectories` kerak, chunki Motionable ma'lumotlari (`~/Motionable`) loyiha papkangizdan tashqarida turadi; agentlar barcha amalni `node .../cli.js` orqali bajaradi, shuning uchun faqat `Bash(node:*)` yetadi. Yoki Claude Code'ni auto / accept-edits rejimida ishga tushiring. `mcp__plugin_motionable_motionable__*` shabloni Claude Code hujjatlarida yozilgan (https://code.claude.com/docs/en/permissions, MCP bo'limi); versiyangiz uni qabul qilmasa, har bir vositani `mcp__plugin_motionable_motionable__<vosita>` ko'rinishida yozing.

### HyperFrames skill'lari

Agentlar `hyperframes`, `hyperframes-cli` va `hyperframes-registry` skill'laridan foydalanadi. O'rnatish: `npx hyperframes skills`. Agar bu ishlamasa: `npx skills add heygen-com/hyperframes --all`. `node dist/cli.js doctor` natijasidagi `skillsMissing` ro'yxati yetishmayotganlarini ko'rsatadi.

### Muammolarni hal qilish

```bash
node "$HOME/.motionable/app/dist/cli.js" doctor
```

`"ok": true` bo'lishi kerak. `ffmpeg` yoki `hyperframes` `false` bo'lsa, o'rnatish skriptini qayta ishga tushiring. Windows (PowerShell): `node "$env:USERPROFILE\.motionable\app\dist\cli.js" doctor`. `ytdlp` `false` bo'lsa, faqat Instagram havolasi bilan ishlash o'chadi; o'z faylingizni berishingiz mumkin. Instagram yuklash to'xtab qolsa, yt-dlp eskirgan bo'lishi mumkin: `yt-dlp -U` bajaring (o'rnatish skripti ham qayta ishga tushganda `~/.motionable/bin` dagi nusxani yangilaydi).

### Litsenziya

MIT.

---

## English

Motionable is a free (MIT) Claude Code plugin that makes short vertical videos (reels) from your reference videos and your own footage. It runs a local browser Studio, an MCP server and three agents.

### Install

Install Node.js 22 or newer first: https://nodejs.org. Then clone this repo and run one command.

Linux / macOS:

```bash
git clone -b plugin https://github.com/akbarship/motionable.git
cd motionable
bash scripts/install.sh
```

Windows (PowerShell):

```powershell
git clone -b plugin https://github.com/akbarship/motionable.git
cd motionable
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

The script downloads ffmpeg and yt-dlp into `~/.motionable/bin` if missing and checks each download against its published checksum. It then copies the app to `~/.motionable/app`, builds it, and prints the two Claude Code commands to run (`claude plugin marketplace add "$HOME/.motionable/app"` and `claude plugin install motionable@motionable`). No sudo or admin rights. Safe to re-run.

### Start

Restart Claude Code and run `/motionable:motionable`.

### Lessons

When a comment you leave on the storyboard or in the chat holds a general rule, it is saved as a lesson (`~/Motionable/lessons.md`; style-specific ones in `~/Motionable/styles/<id>/lessons.md`). Every later video is planned with these rules. The Settings page lists the lessons, lets you add one by hand and delete a wrong one.

### What works with no keys

Almost the whole pipeline works without keys. The exception comes first: captions need word timings, so you need an STT provider or a script you paste. Everything else works: reference study, style, director plan, preview, chat edits and render. Only AI generation (image/video) is off.

### Keys

- Your own: kie.ai (image/video), ElevenLabs (subtitles/voice), entered in Studio Settings.
- Or the bot: coming soon.

Paid calls need Approve in the Studio. The exception is STT, which runs on its own once enabled (about $0.004/min).

### Permissions

Agents run many commands, so Claude Code asks for permission often. To speed this up, add to `.claude/settings.json` in your project:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "mcp__plugin_motionable_motionable__*"
    ],
    "additionalDirectories": ["~/Motionable"]
  }
}
```

`additionalDirectories` is needed because Motionable data (`~/Motionable`) lives outside your project folder; agents do all shell work through `node .../cli.js`, so `Bash(node:*)` is enough. Or run Claude Code in auto / accept-edits mode. The `mcp__<server>__*` wildcard and the `Bash(cmd:*)` suffix are documented at https://code.claude.com/docs/en/permissions (MCP section). If your Claude Code version rejects the wildcard, list each tool as `mcp__plugin_motionable_motionable__<tool>`.

### HyperFrames skills

Agents use the `hyperframes`, `hyperframes-cli` and `hyperframes-registry` skills. Install with `npx hyperframes skills`; if that is unavailable, `npx skills add heygen-com/hyperframes --all`. `doctor` lists missing ones under `skillsMissing`.

### Troubleshooting

Run `node "$HOME/.motionable/app/dist/cli.js" doctor` (PowerShell: `node "$env:USERPROFILE\.motionable\app\dist\cli.js" doctor`). Expect `"ok": true`. If `ffmpeg` or `hyperframes` is `false`, re-run the installer. If `ytdlp` is `false`, Instagram links will not download; you can still use your own files. If Instagram downloads start failing, yt-dlp is probably out of date: run `yt-dlp -U` (the installer also updates its own copy in `~/.motionable/bin` on re-run).

### License

MIT.
