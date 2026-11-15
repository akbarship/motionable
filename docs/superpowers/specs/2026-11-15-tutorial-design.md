# Motionable: plagin o'rniga qo'llanma + promptlar

Sana: 2026-11-15

## Maqsad

Plagin (Studio, MCP, agentlar) ko'p token yeydi va moslashuvchan emas. Uning o'rniga oddiy odam o'z montaj loyihasini o'zi quradigan PDF qo'llanma va tayyor promptlar ulashiladi. Natija: o'quvchining o'z uslubi va preferenslari bilan ishlaydigan shaxsiy loyihasi.

## Qarorlar (foydalanuvchi tasdiqlagan)

- Format: PDF qo'llanma ("qanday ishlaydi") + hamma narsani tayyor qilib beradigan promptlar. Oddiy odamga tushunarli.
- Vosita: Claude desktop ilovasi + HyperFrames. Terminal deyarli kerak emas.
- Qamrov: o'rnatish + papka, o'z uslubi (namunadan), video yasash sikli, saboqlar.
- Plagin kodi `plugin` branchida saqlanadi (yaratildi va push qilindi, 7d0a6ad). `main` da qo'llanma, promptlar va PDF qoladi.

## Taxminlar

- Til: o'zbekcha (lotin).
- PDF dizayni: och krem #F4F1EA + coral #C9643F.
- Bepul, MIT, shu repoda tarqatiladi.

## Repo tuzilmasi (main)

```
README.md            qo'llanmaga kirish, PDF havolasi, plagin uchun `plugin` branchi
LICENSE
guide/
  guide.html         PDF manbasi
  motionable-qollanma.pdf
prompts/
  1-ornatish.md
  2-uslub.md
  3-video.md
  4-saboq.md
```

Plagin fayllari (`src`, `studio`, `agents`, `skills`, `scripts`, `tests`, `package.json` va h.k.) `main` dan olib tashlanadi. Bu qadam qo'llanma tayyor bo'lgach, bitta commitda bajariladi.

`plugin` branchi: README o'rnatish buyrug'i `git clone -b plugin ...` ga o'zgaradi; `plugin:refresh` va o'rnatish skriptlari shu branchdan ishlashi tekshiriladi.

## O'quvchi loyihasi (1-prompt yaratadi)

```
CLAUDE.md      qisqa qoidalar (60 qatorgacha), qaysi faylni qachon o'qish
style.md       uslub: rang, shrift, ritm, subtitr
lessons.md     saboqlar, har biri bir qator
refs/          namunaviy reellar
footage/       o'quvchining kadrlari
videos/<nom>/  har video alohida papkada
```

Studio, MCP, agentlar yo'q. Faqat Claude desktop ilovasi, HyperFrames va ffmpeg.

## Promptlar

1. `1-ornatish.md`: Node, ffmpeg, HyperFrames borligini tekshiradi, yo'g'ini o'rnatadi; papkani quradi; 5-6 savol so'raydi (mavzu, til, format, yoqtirmaydigan narsalar) va javoblarni `CLAUDE.md` ga yozadi.
2. `2-uslub.md`: 2-3 namunaviy reeldan kadrlar oladi, `style.md` yozadi, bitta sinov kadr ko'rsatadi, o'quvchi tasdiqlaydi.
3. `3-video.md`: ssenariy/kadr -> qisqa reja -> stillar -> tasdiq -> preview -> render. Har video uchun qayta ishlatiladi.
4. `4-saboq.md`: izoh umumiy qoida bo'lsa `lessons.md` ga bir qator qo'shadi; bir martalik tuzatish saqlanmaydi.

1-promptdan keyingi promptlar qisqa (2-3 qator): qoidalar loyiha fayllarida yashaydi.

## Token tejash

- Fayllar qisqa, faqat kerak bo'lganda o'qiladi.
- Render oldidan stillar tekshiriladi.
- Har video yangi chatda.
- Subagentlar va navbat yo'q.

## PDF qo'llanma (~10-12 bet)

1. Bu nima va qanday ishlaydi (bitta sxema)
2. Nima kerak (Claude obunasi, kompyuter)
3. 1-qadam: o'rnatish
4. 2-qadam: o'z uslubingiz
5. 3-qadam: birinchi video
6. 4-qadam: saboqlar
7. Token tejash
8. Tez-tez uchraydigan muammolar

Har qadamda: prompt, kutilgan natija, skrinshot joyi. Jargon yo'q.

## Tekshiruv

- 4 promptni toza papkada boshidan oxirigacha yurgizish, bitta qisqa video render qilish.
- PDF har sahifasini ko'z bilan tekshirish.
- Oddiy odam testini foydalanuvchi o'tkazadi.

## Ochiq savollar

- Claude desktop ilovasida HyperFrames o'rnatish yo'li: rejada tekshiriladi. Ishlamasa, 1-prompt o'rnatishni o'zi bajaradi.
- Subtitr uchun so'z vaqtlari (STT): kalitsiz yo'l (matn yopishtirish) asosiy, STT ixtiyoriy bo'lim.
