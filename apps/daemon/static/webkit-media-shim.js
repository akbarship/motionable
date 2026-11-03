// WebKitGTK media shim for the Studio preview. Loaded before the HyperFrames runtime, active only in WebKitGTK
// (Linux WebKit browsers); Chromium, Firefox and Safari never run it.
//
// Why: in WebKitGTK every seek leaves the video ~0.37 s behind (GStreamer prerolls while the player's clock runs on),
// and every playbackRate change is itself a flushing seek. The runtime chases that lag by nudging the rate (1.1,
// 1.25), which flushes again: black frames and stutter in a loop. So here: corrective rate changes are dropped, and a
// lag is closed with one seek that lands ahead by the seek latency, learned per element.
(function () {
  const LAG0 = 0.35; // s: a WebKitGTK seek's latency before any is measured
  const DRIFT = 0.12; // s: drift worth correcting
  const HOLD_MS = 500; // drift must last this long (one late frame isn't a drift)
  const GAP_MS = 2000; // between two corrective seeks of one element
  const CHECK_MS = 1000; // after a seek, when the remaining drift teaches the lag

  /** Where a clip's media should be at timeline time t (seconds), or null outside its span (and its last 0.3 s). */
  const expectedTime = (t, start, duration, mediaStart) =>
    t < start || t > start + duration - 0.3 ? null : t - start + (mediaStart || 0);

  /** The seek latency after a corrective seek left `residual` seconds still to go (positive: still behind). */
  const nextLag = (lag, residual) => Math.min(1, Math.max(0, lag + residual));

  /** Seek now? Only for a drift that has lasted, and not right after another seek. */
  const shouldSeek = (drift, driftSince, now, lastSeek) =>
    Math.abs(drift) > DRIFT && driftSince !== null && now - driftSince >= HOLD_MS && now - lastSeek >= GAP_MS;

  const api = {expectedTime, nextLag, shouldSeek, LAG0};
  if (typeof globalThis !== 'undefined') globalThis.__mcMediaSync = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const ua = navigator.userAgent;
  // WebKitGTK only (Linux: Epiphany, GNOME Web): Safari plays through AVFoundation and Chromium is fine as it is
  if (!/AppleWebKit/.test(ua) || !/Linux/.test(ua) || /Chrome|Chromium|Edg\/|Android/.test(ua)) return;

  // the <hyperframes-player> this page plays in (same origin: the iframe sits in its shadow root)
  const host = () => {
    try {
      const root = window.frameElement && window.frameElement.getRootNode();
      return root && root.host ? root.host : null;
    } catch (e) {
      return null;
    }
  };

  // 1. the user's rate goes through; the runtime's corrective rates don't
  const proto = HTMLMediaElement.prototype;
  const rate = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
  const time = Object.getOwnPropertyDescriptor(proto, 'currentTime');
  Object.defineProperty(proto, 'playbackRate', {
    configurable: true,
    get() { return rate.get.call(this); },
    set(x) {
      const h = host();
      const user = h && Number.isFinite(h.playbackRate) ? h.playbackRate : 1;
      if (Math.abs(x - user) < 1e-6) rate.set.call(this, x);
    },
  });

  // 2. a lasting drift is closed by one seek that lands ahead by the element's seek latency
  const state = new WeakMap();
  let lastT = null;
  let lastAt = 0;
  setInterval(() => {
    const h = host();
    const now = performance.now();
    if (!h || h.paused) { lastT = null; return; }
    const t = h.currentTime;
    // the user scrubbed (the timeline jumped): let the runtime place the media, look again in a moment
    const jumped = lastT !== null && Math.abs(t - lastT - (now - lastAt) / 1000 * (h.playbackRate || 1)) > 0.5;
    lastT = t;
    lastAt = now;
    for (const el of document.querySelectorAll('video.clip, audio.clip')) {
      let s = state.get(el);
      if (!s) state.set(el, (s = {lag: LAG0, since: null, lastSeek: -Infinity, check: null}));
      const exp = expectedTime(t, Number(el.dataset.start), Number(el.dataset.duration), Number(el.dataset.mediaStart || 0));
      if (jumped) s.lastSeek = now;
      if (exp === null || el.paused || el.seeking || el.readyState < 2) { s.since = null; continue; }
      const drift = exp - time.get.call(el);
      if (s.check !== null && now >= s.check) {
        s.lag = nextLag(s.lag, drift);
        s.check = null;
      }
      s.since = Math.abs(drift) > DRIFT ? (s.since ?? now) : null;
      if (shouldSeek(drift, s.since, now, s.lastSeek)) {
        time.set.call(el, exp + s.lag);
        s.lastSeek = now;
        s.since = null;
        s.check = now + CHECK_MS;
      }
    }
  }, 250);
})();
