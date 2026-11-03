# Engine check: HyperFrames footage (2026-10-31)
- Test: a 40 s talking-head source → ffmpeg conform (1080×1920, CFR 30, H.264 GOP 15) → HyperFrames `<video>` only, 39.9 s, 1198 frames.
- Frames: SSIM vs the base clip, shift 0 mean 0.991 / min 0.989 (all 1198 frames); shift ±1 mean 0.965. Frame-exact.
- Audio: 0 ms offset (cross-correlation, first 20 s). Frame count and duration match.
- Speed (Linux, software GL, screenshot capture): looks 1 worker 150 s; draft 4 workers 72 s, 8 workers 75 s; ~690 MB RAM.
- Verdict: pass. Base footage goes in as one conformed clip; no alpha-overlay fallback needed.
- Face track (2026-10-31): YuNet on onnxruntime-web (WASM, 1 thread), 10 samples/s, 640² letterbox. A 39.9 s talking head: 24.6 s.
- Against an OpenCV (Python) track of the same video (399 samples): mean |Δ| cx 0.003, cy 0.005, w 0.003, h 0.007 (max cy 0.010). Same.
- Export (2026-11-01, a 39.4 s edit): delivery render + 2-pass loudnorm in 136 s → −14.0 LUFS, −0.8 dBFS peak.
  The page's sound: music bed (−24 dB), a whoosh at its frame, the closing fade (−36 → −77 dB over the last 1 s).
- WebKitGTK preview (Linux WebKit browsers, 2026-11-01): each seek leaves media ~0.37 s behind; the runtime's rate nudges (1.1/1.25)
  are flushing seeks there → black flashes. static/webkit-media-shim.js drops them, closes lag with one ahead-seek: ±0.05 s.
