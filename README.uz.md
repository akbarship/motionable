# Motionable

**Gapiruvchi video (talking head) dan o'z uslubingizdagi reels.** Montajni sizning Claude Code'ingiz qiladi:
qayta olingan joylar va "ee"larni kesadi, subtitr yozadi, sarlavha, b-roll, o'tish va ovozlarni qo'yadi.
Motionable esa kompyuteringizdagi studiya: montajni ko'rasiz, qo'lda tuzatasiz, Claude'ga izoh qoldirasiz va
eksport qilasiz.

Bepul va ochiq kodli (MIT). [English](README.md)

- **Shablon emas, o'z uslubingiz.** Yoqqan 2–3 ta reels'ni yuklaysiz, Claude ularni o'rganib dizayn tizimingizni
  quradi: ranglar, shriftlar, subtitr tizimi, ritm, komponentlar. Har bir qiymat qayerdan olingani yoziladi.
- **Matn orqali montaj.** Timestamp'li transkript: so'zni bosing — o'sha joyga o'tadi, belgilang — kesiladi.
- **Aniq joyga izoh.** 00:11.8 da "bu yerda kesish tezroq bo'lsin" → Claude tuzatib, javob yozadi.
- **Eslab qoladi.** Bir marta "bu yoqmadi" desangiz, bu saboqqa aylanadi va o'sha xato keyin qaytarilmaydi.
- **Subtitr yuzni yopmaydi.** Yuz kuzatuvchi matnni yuzdan uzoqda tutadi.
- **Eksport** reels uchun: MP4 (−14 LUFS) va SRT.

## Talablar
- **Node.js 22+** va **ffmpeg** (`ffprobe` bilan), PATH'da
- **[Claude Code](https://claude.com/claude-code)** va Claude obunasi
- Transkript uchun **ElevenLabs** API kaliti (pullik, o'z hisobingizdan; har chaqiruvdan oldin so'raladi)
- Ubuntu 24.04 va Chrome'da sinalgan. macOS va Windows hali sinalmagan: xabar va tuzatishlar xush kelibsiz.

## O'rnatish
```bash
git clone https://github.com/akbarship/motionable.git
cd motionable
npm install          # render uchun Chrome ham yuklanadi
npm run build        # Studio'ni yig'adi
npm start            # lokal server: http://127.0.0.1:4377
```
Chrome'da **http://127.0.0.1:4377** ni oching. So'ng Claude Code'ni ulang (bir marta):
```bash
npm run connect      # Claude Code'ga motionable MCP server va skill'ini qo'shadi
```
(Yoki shu papkada `claude` ni ochsangiz ham bo'ladi.) ElevenLabs kalitini ⚙ Sozlamalarga kiriting.

## Birinchi video
1. **Uslublar → yangi uslub:** 2–3 ta referens reels yuklang, promptni Claude Code'ga qo'ying. Claude ularni
   o'rganadi, uslubni saqlaydi va komponentlarni yozadi (har biri tekshiruvdan o'tadi). Namunani ko'ring.
2. **+ Yangi loyiha:** videongizni tanlang. Bepul analiz o'tadi, keyin transkript (pullik, tasdiqlaysiz),
   keyin uslub va kamerani tanlaysiz.
3. Claude Code'da: *"Motionable'dagi &lt;nom&gt; loyihasini mening uslubimda montaj qil."* Studio'da kuzatib turing.
4. Qo'lda tuzating (so'zlarni kesish, sarlavhani sudrash, subtitr qatorini o'zgartirish) yoki **izoh** qoldirib
   *Claude'ga yuborish* ni bosing.
5. **Eksport.** Tayyor video **Videolarim** da.

## Ma'lumotlar qayerda
`~/Motionable` — loyihalar va uslublar; `~/.motionable` — sozlamalar, kalitlar va saboqlar. Hech narsa hech
qayerga yuklanmaydi, faqat transkript uchun ovoz ElevenLabs'ga yuboriladi.

Server faqat `127.0.0.1` da tinglaydi va faqat shu kompyuterga yo'llangan so'rovlarga javob beradi: boshqa saytlar
unga ulana olmaydi. 4377-portni tarmoqqa ochmang.

## Dasturchilar uchun
`npm run dev` (Studio, `npm start` yonida), `npm test`, `npm run typecheck`.
Arxitektura va qoidalar: [CLAUDE.md](CLAUDE.md). Komponentlar: [docs/v2/components.md](docs/v2/components.md).

## Loyihani qo'llab-quvvatlash
Motionable bepul. Agar vaqtingizni tejasa, rivojlanishiga hissa qo'shishingiz mumkin:

<!-- DONATE: muallifning donat rekvizitlari shu yerga -->

## Litsenziya
MIT. Uchinchi tomon qismlari: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
