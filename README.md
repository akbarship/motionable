# Motionable

## O'zbekcha

Claude yordamida o'z video montaj loyihangizni quring: o'z uslubingiz, o'z qoidalaringiz bilan. Dasturchi bo'lish shart emas. Kerak bo'ladigani: bitta PDF qo'llanma va 4 ta tayyor prompt.

**[PDF qo'llanmani ochish](guide/motionable-qollanma.pdf)**

### Qanday ishlaydi

Kompyuteringizda oddiy papka bo'ladi. Claude shu papka ichida ishlaydi:

1. Yoqqan videolaringizdan uslubingizni o'rganadi va `style.md` fayliga yozadi.
2. Sizning tasdig'ingiz bilan video yasaydi: avval reja, keyin kadrlar, oxirida MP4.
3. Izohlaringizni `lessons.md` fayliga saqlaydi va keyingi videolarda qo'llaydi.

Hamma fayl oddiy matn. Xohlagan payt o'zingiz o'zgartirasiz.

### Nima kerak

- Kompyuter: Windows, macOS yoki Linux.
- Kompyuter uchun Claude ilovasi va pullik Claude obunasi.
- Sizga yoqqan 2 yoki 3 ta qisqa video (bo'lmasa ham boshlasa bo'ladi).

Node.js, FFmpeg va [HyperFrames](https://hyperframes.heygen.com) ni Claude o'zi o'rnatadi. Qo'shimcha kalit yoki to'lov shart emas.

### Boshlash

1. Kompyuterda bo'sh papka yarating. Claude ilovasida **Code** bo'limini oching va shu papkani tanlang.
2. Promptlarni tartib bilan chatga tashlang:

| Qadam | Prompt | Qachon |
| --- | --- | --- |
| 1. O'rnatish | [prompts/1-ornatish.md](prompts/1-ornatish.md) | Bir marta |
| 2. O'z uslubingiz | [prompts/2-uslub.md](prompts/2-uslub.md) | Bir marta, yangi chatda |
| 3. Video yasash | [prompts/3-video.md](prompts/3-video.md) | Har video uchun, yangi chatda |
| 4. Saboq | [prompts/4-saboq.md](prompts/4-saboq.md) | Kerak bo'lganda |

Har qadamda nima bo'lishi va muammolar yechimi qo'llanmada yozilgan.

### Eski plagin

Studio, MCP server va agentlar bilan ishlaydigan Claude Code plagini [`plugin` branchida](https://github.com/akbarship/motionable/tree/plugin) saqlanadi. Bu yo'l ko'proq token sarflaydi va kamroq moslashuvchan, shuning uchun asosiy yo'l endi shu qo'llanma.

## English

Build your own video editing project with Claude, in your own style and with your own rules. No coding needed: one PDF guide and four copy-paste prompts. The guide and prompts are written in Uzbek.

- **Guide:** [guide/motionable-qollanma.pdf](guide/motionable-qollanma.pdf)
- **Prompts:** [prompts/](prompts/), run in order inside the Claude desktop app (Code tab) with an empty folder selected.

What you get: a plain folder where Claude learns your style from reference videos into `style.md`, makes vertical videos with [HyperFrames](https://hyperframes.heygen.com) (plan, stills, then MP4, each with your approval) and keeps your feedback in `lessons.md` for the next video. No extra API keys are required.

The earlier Claude Code plugin (Studio, MCP server, agents) lives on the [`plugin` branch](https://github.com/akbarship/motionable/tree/plugin).

To rebuild the PDF after editing the guide or prompts: `python3 guide/build.py` (needs Chrome or Chromium).

## License

MIT. See [LICENSE](LICENSE).
