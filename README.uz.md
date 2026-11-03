# Motionable

**Gapiruvchi video (talking head) dan o'z uslubingizdagi reels.** Montajni sizning Claude Code'ingiz qiladi:
qayta olingan joylar va "ee"larni kesadi, subtitr yozadi, sarlavha, b-roll, o'tish va ovozlarni qo'yadi.
Motionable esa kompyuteringizdagi studiya: montajni ko'rasiz, qo'lda tuzatasiz, Claude'ga izoh qoldirasiz va
eksport qilasiz.

Bepul va ochiq kodli (MIT). [English](README.md)

- **Shablon emas, o'z uslubingiz.** Yoqqan 2–3 ta reels'ni yuklaysiz, Claude ularni o'rganib dizayn tizimingizni
  quradi: ranglar, shriftlar, subtitr tizimi, ritm, komponentlar. Har bir qiymat qayerdan olingani yoziladi.
- **Montajdan oldin reja.** Video nima haqida, format, uslub va fayllarni berasiz: Claude sahnama-sahna reja
  yozadi, har bir tanlovning sababi bilan. Montajni faqat siz rozi bo'lgandan keyin qiladi.
- **Voiceover motion.** Video yo'qmi? Ovozdan to'liq motion va b-roll'dan iborat reels yasaladi.
- **Matn orqali montaj.** Timestamp'li transkript: so'zni bosing — o'sha joyga o'tadi, belgilang — kesiladi.
- **Aniq joyga izoh.** 00:11.8 da "bu yerda kesish tezroq bo'lsin" → Claude tuzatib, javob yozadi.
- **Eslab qoladi.** Bir marta "bu yoqmadi" desangiz, bu saboqqa aylanadi va o'sha xato keyin qaytarilmaydi.
- **Subtitr yuzni yopmaydi.** Yuz kuzatuvchi matnni yuzdan uzoqda tutadi.
- **Eksport** reels uchun: MP4 (−14 LUFS) va SRT.

## Talablar
- **[Claude Code](https://claude.com/claude-code)** va Claude obunasi (terminal, desktop app yoki IDE)
- Windows 10/11, macOS (Intel yoki Apple silicon) yoki Linux. Node.js va ffmpeg'ni o'rnatuvchining o'zi olib keladi.
- Ixtiyoriy kalitlar, Studio'dagi ⚙ Sozlamalar'da: transkript uchun **ElevenLabs** (pullik, o'z hisobingizdan; har
  chaqiruvdan oldin so'raladi), stock b-roll uchun **Pexels** va **Pixabay** (bepul).

## O'rnatish
Terminalda bitta qator. Admin huquqi kerak emas; yangilash uchun yana ishga tushiring.

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.sh | bash
```
**Windows** (PowerShell)
```powershell
irm https://raw.githubusercontent.com/akbarship/motionable/main/scripts/install.ps1 | iex
```
U `~/.motionable/app` ga o'rnatadi, tilni va videolar papkasini so'raydi, Claude Code'ga ulaydi. So'ng Claude Code'ni
oching va **`/motionable`** deb yozing: Studio ochiladi.

**Claude Code plagini sifatida:** `/plugin marketplace add akbarship/motionable`, `/plugin install motionable`, so'ng
`/motionable`: qolganini Claude siz bilan bitta-bitta savol bilan sozlaydi va biror narsa o'rnatishdan oldin so'raydi.

## Birinchi video
1. Claude Code'da **`/motionable`**. Studio ochiladi; pill *Claude ulangan* deydi: Claude Studio'ni kutyapti.
2. **+ Yangi video:** nima haqida (skript bo'lsa, u ham), format (*Montaj* yoki *Voiceover motion*) va uslub.
   Uslub yo'qmi? Yoqqan 2–3 ta reels'ni yuklang: siz davom etguncha Claude uni quradi.
3. **Materiallar:** videongiz (yoki ovoz fayli), b-roll, rasm, musiqa. Transkriptga rozilik bering (pullik,
   ElevenLabs) va *Claude'ga yuborish* ni bosing.
4. **Reja:** davomiylik, nima kesiladi, har bir sahna: nima bo'ladi va nega. *Roziman* yoki nimani o'zgartirishni yozing.
5. Claude montaj qiladi, siz Studio'da kuzatasiz. Qo'lda tuzating (Elementlar: surish, o'chirish, "bu yoqmadi")
   yoki **izoh** qoldirib *Claude'ga yuborish* ni bosing. **Eksport**, tayyori **Videolarim** da.

Claude sizning chat sessiyangizda, o'z obunangizda ishlaydi; har qadamini o'sha yerda ko'rasiz. U bilan gaplashish
uchun Esc bosing; keyin u yana Studio'ni kutishga qaytadi.

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
