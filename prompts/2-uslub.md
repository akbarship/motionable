Mening uslubimni aniqlaymiz. Natija: `style.md` fayli va bitta sinov kadr.

QADAM 1. Namunalarni toping

`refs/` papkasiga qarang.

- Video bor bo'lsa: 2-qadamga o'ting.
- Bo'sh bo'lsa: menga ayting. Men video tashlashim yoki "namunasiz" deyishim mumkin. "Namunasiz" desam, 2-qadamni o'tkazib yuboring va menga 5 ta savol bering: kayfiyat, ranglar, shrift (qalin yoki nozik), matn ko'p yoki kam, tez yoki sokin ritm.

QADAM 2. Namunalarni o'rganing

Avval `refs/_kadrlar/` papkasini yarating. Har video uchun kadrlar jadvalini yasang (bir sekundda bitta kadr, kichik o'lchamda, bir rasmga 20 ta kadr):

```
ffmpeg -i refs/<fayl> -vf "fps=1,scale=270:-1,tile=5x4" refs/_kadrlar/<nom>-%02d.jpg
```

Jadvallarga qarang. Kerak bo'lsa, 3-4 ta muhim lahzadan to'liq o'lchamdagi kadr oling. Butun videoni kadrma-kadr ko'rmang.

Nimaga qarash kerak: ranglar, shrift, matn o'lchami va joyi, subtitr ko'rinishi, sahna qancha davom etadi, sahnalar qanday almashadi, narsalar ekranga qanday kiradi.

QADAM 3. `style.md` yozing

Aniq raqamlar bilan yozing, umumiy so'zlar bilan emas. 80 qatordan oshmasin. Bo'limlar:

```
# Mening uslubim

## Kayfiyat
(2-3 gap)

## Ranglar
(fon, asosiy matn, urg'u rangi: har biri hex kod va qayerda ishlatilishi bilan)

## Shriftlar
(Google Fonts'dan nom, qalinlik, qayerda ishlatiladi)

## Matn o'lchamlari
(1080x1920 kadrda piksel hisobida: sarlavha, oddiy matn, subtitr)

## Subtitr
(joyi, bir vaqtda nechta so'z, urg'u so'z qanday ajratiladi)

## Ritm
(sahna o'rtacha necha soniya, kesishlar qachon)

## Harakat
(narsalar qanday kiradi va chiqadi, tezlik, sahna almashuvi)

## Joylashuv
(chetdan bo'sh joy, matn va yuz qayerda turadi)

## Hech qachon
(bu uslubda ishlatilmaydigan narsalar)
```

Muhim: namunadan faqat uslubni oling. Birovning logotipi, yuzi, matni yoki musiqasini ko'chirmang. `CLAUDE.md` dagi "Yoqadi" va "Yoqmaydi" qatorlarini ham hisobga oling.

QADAM 4. Sinov kadr

`videos/_sinov/` papkasida 3 soniyali bitta sahna yasang: mening mavzuimga oid bitta sarlavha va bitta subtitr qatori, `style.md` bo'yicha. Tekshiring (`npx hyperframes check --json`), bitta kadr oling va menga ko'rsating.

So'rang: "Shu sizning uslubingizmi? Nimani o'zgartiray?" Men aytgan o'zgarishlarni avval `style.md` ga yozing, keyin kadrni yangilang. Men "ha" demaguncha takrorlang.
