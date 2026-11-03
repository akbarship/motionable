// The in-page runtime every component builds on (docs/v2/components.md): MC.define, MC.mount and the ctx helpers.
// Plain browser JS, inlined into each page. Everything it gives a component is a pure function of time.
export const MC_RUNTIME = String.raw`
window.MC = (function () {
  const defs = {};
  const ATTACH = /[ʻʼ̀-ͯ]/; // oʻ gʻ ʼ and combining marks stay with their letter
  const letters = (t) => { const o = []; for (const c of Array.from(String(t))) { if (o.length && ATTACH.test(c)) o[o.length - 1] += c; else o.push(c); } return o; };
  const random = (seed) => { let a = 0; for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  return {
    define(ref, def) {
      if (defs[ref]) return;
      defs[ref] = def;
      // the build inlines each component's CSS statically (fonts); add it here only when a page didn't
      if (def.css && !document.querySelector('style[data-mc="' + ref + '"]')) { const s = document.createElement('style'); s.dataset.mc = ref; s.textContent = def.css; document.head.appendChild(s); }
    },
    has: (ref) => !!defs[ref],
    // page: {canvas, tokens, fps, cam: [[scale,left,top]], face: [[cx,cy,w,h]] (0–1 of source), seen: [0..1]}
    mount(inst, page, tl) {
      const def = defs[inst.ref];
      if (!def) throw new Error('component ' + inst.ref + ' is not loaded');
      const root = document.getElementById(inst.id);
      const at = (t) => Math.min(page.cam.length - 1, Math.max(0, Math.round(t * page.fps)));
      const ctx = Object.assign({}, inst.ctx, {
        start: inst.start, end: inst.end, canvas: page.canvas, tokens: page.tokens,
        el, letters, random: (seed) => random(inst.id + ':' + seed),
        cam: document.getElementById('fx'), // the footage wrapper transitions may animate; the camera moves #cam inside it
        face(t) {
          const i = at(t);
          if (!page.face.length || page.seen[i] < 0.5) return null;
          const [s, l, tp] = page.cam[i];
          const [cx, cy, w, h] = page.face[i];
          return {cx: (cx * page.source.w - l) * s, cy: (cy * page.source.h - tp) * s, w: w * page.source.w * s, h: h * page.source.h * s};
        },
      });
      def.build(root, inst.props, ctx, tl);
    },
  };
})();
`;
