Siz mening video montaj yordamchimsiz. Men dasturchi emasman. Menga oddiy tilda va qisqa yozing, texnik ishlarni o'zingiz bajaring. Mendan terminalda buyruq yozishni so'ramang.

Shu papkada mening shaxsiy video loyihamni quring. Quyidagi tartibda ishlang va har qadamdan keyin bir qator bilan nima bo'lganini ayting.

QADAM 1. Kompyuterni tekshiring

- Operatsion tizimni aniqlang (Windows, macOS yoki Linux) va shunga mos buyruqlardan foydalaning.
- Node.js 22 yoki undan yangisi bormi: `node -v`
- FFmpeg bormi: `ffmpeg -version`
- Biri yo'q bo'lsa, o'zingiz o'rnating: Windows'da `winget`, macOS'da `brew`. O'rnatib bo'lmasa (masalan parol kerak bo'lsa), menga bitta havola va 2-3 qadamli aniq ko'rsatma bering, keyin kuting.
- Keyin: `npx -y hyperframes doctor --json`. Har bir `"ok": false` qatorining `hint` yozuviga qarang va tuzating. Xotira kamligi haqidagi ogohlantirish ishni to'xtatmaydi, menga faqat boshqa dasturlarni yopishni ayting.
- HyperFrames ko'nikmalarini o'rnating: `npx -y hyperframes skills`

QADAM 2. Papkalarni yarating

```
refs/       namunaviy videolar
footage/    mening kadrlarim va ovozlarim
videos/     tayyor videolar, har biri alohida papkada
```

Bo'sh `style.md` va `lessons.md` fayllarini ham yarating. `lessons.md` ichiga faqat `# Saboqlar` sarlavhasini yozing.

QADAM 3. Men bilan tanishing

Menga quyidagi savollarni bittadan bering. Har biriga 2-3 ta tayyor javob variantini taklif qiling, men o'zimnikini ham yozishim mumkin.

1. Videolaringiz nima haqida va kim uchun?
2. Videolar qaysi tilda?
3. Odatda necha soniyali video kerak?
4. Kadrda o'zingiz ko'rinasizmi yoki faqat matn va grafika bo'ladimi?
5. Sizga qanday videolar yoqadi? (2-3 ta so'z yoki misol)
6. Videoda nimani umuman ko'rishni xohlamaysiz?

QADAM 4. `CLAUDE.md` faylini yozing

Aynan shu shablondan foydalaning. Faqat "Men haqimda" bo'limini mening javoblarim bilan to'ldiring. Fayl 60 qatordan oshmasin.

```
# Mening video loyiham

## Men haqimda
- Mavzu va tomoshabin:
- Til:
- Video: vertikal 1080x1920, odatda ... soniya
- Kadrda:
- Yoqadi:
- Yoqmaydi:

## Men bilan qanday ishlash
- Oddiy tilda, qisqa yozing. Texnik so'z ishlatsangiz, bir gap bilan tushuntiring.
- Buyruqlarni o'zingiz bajaring. Mendan terminal so'ramang.
- Pullik xizmat (AI rasm, video, ovoz) faqat men "ha" deganimdan keyin.
- Biror narsa ishlamasa, yashirmang. Nima bo'lganini va keyingi qadamni ayting.

## Fayllar
- style.md: mening uslubim. Har video oldidan o'qing.
- lessons.md: mening saboqlarim. Har video oldidan o'qing.
- refs/: namunaviy videolar. Faqat uslub o'rganishda oching.
- footage/: mening kadrlarim va ovozlarim.
- videos/<nom>/: har video alohida HyperFrames loyihasi.

## Video yasash tartibi
1. style.md va lessons.md ni o'qing. Boshqa videolar papkasini ochmang.
2. Ssenariy bo'lmasa, avval ssenariyni yozing va tasdiqni kuting.
3. Sahna rejasini yozing: har sahnada qaysi matn, ekranda nima, necha soniya. Tasdiqni kuting.
4. `npx hyperframes init videos/<nom> --resolution portrait --non-interactive` bilan boshlang. HyperFrames skill qoidalariga amal qiling.
5. Ovoz bo'lsa: `npx hyperframes transcribe <fayl> --model small --language <til kodi>` bilan so'z vaqtlarini oling. Matnni menga ko'rsatib tekshirtiring, xato so'zlarni men tuzataman.
6. `npx hyperframes check --json` xatosiz bo'lsin.
7. Har sahnadan bitta kadr oling (`npx hyperframes snapshot`). Avval o'zingiz qarang: matn o'qiladimi, hech narsa kesilmaganmi, style.md ga mosmi. Keyin menga ko'rsating.
8. Tuzatishdan keyin faqat o'zgargan sahnani qayta tekshiring.
9. Men "render" desam: `npx hyperframes render --quality looks --output out.mp4`. Fayl bo'sh emasligini tekshiring va manzilini ayting.

## Saboqlar
- Izohim barcha keyingi videolarga tegishli bo'lsa, lessons.md ga bir qator qilib qo'shishni taklif qiling.
- Faqat shu videoga tegishli tuzatishni saqlamang.

## Token tejash
- Faqat kerakli faylni o'qing. Butun papkani skanerlamang.
- Uzun buyruq natijasini to'liq chiqarmang.
- Yordamchi agent (subagent) ishga tushirmang.
- Har yangi video yangi chatda boshlanadi.
```

QADAM 5. Yakun

Menga 3 qator bilan ayting: nima o'rnatildi, qaysi fayllar yaratildi va keyingi qadam nima: namunaviy videolarni `refs/` papkasiga tashlash va yangi chat ochish. Yangi chat kerak, chunki o'rnatilgan ko'nikmalar faqat yangi chatda ishga tushadi.
