# Third-party notices

Motionable is MIT-licensed (see LICENSE). It builds on the following; their licences apply to their parts.

| Part | Where | Licence |
|---|---|---|
| YuNet face detector model (OpenCV Zoo, `face_detection_yunet_2023mar.onnx`) | `packages/engine/models/` (bundled) | MIT, © 2020 Shiqi Yu |
| HyperFrames (`hyperframes`, `@hyperframes/*`) | npm dependency: page engine, player, renderer | Apache-2.0 |
| onnxruntime-web | npm dependency: runs YuNet in WebAssembly | MIT |
| React, Vite, Fastify, zod, Ajv, the MCP SDK and the other npm dependencies | `package-lock.json` | their own (MIT / Apache-2.0 / ISC / BSD) |
| ffmpeg-skill | one threshold (held vowels, `packages/plan/src/cutter.ts`) | MIT |
| Google Fonts (Inter, Montserrat, League Gothic, …) | loaded at run time by the preview and the renders | SIL Open Font License |

Not bundled (downloaded onto the user's computer at install time, never part of this repository):
- **ffmpeg / ffprobe** static builds (GPL or LGPL, see each build's notice): johnvansickle.com (Linux), gyan.dev
  (Windows), ffmpeg.martin-riedl.de (macOS). `npm run setup -- --ffmpeg` downloads them into `~/.motionable/bin`.
  An ffmpeg already on your PATH works as well.
- **Node.js** (MIT) from nodejs.org, when the installer finds no Node 22+.
- The **Chrome** that HyperFrames' renderer downloads (puppeteer).
- Services you call with your own keys: **ElevenLabs** (transcripts), **Pexels** and **Pixabay** (stock b-roll; each
  clip keeps its source and author, and an export lists them in `credits.txt`; their licences allow free use without
  attribution, and credit is given anyway).
