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

Not bundled: **ffmpeg** (install it on your system; its licence is yours to check for what you distribute), the
Chrome that HyperFrames' renderer downloads, and the ElevenLabs service you call with your own key.
