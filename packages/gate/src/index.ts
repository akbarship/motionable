// The component gate (docs/v2/components.md): a component the user's Claude wrote is used only after it passes.
// Static checks on the source, HyperFrames lint and layout on test pages (Uzbek text, long text, prop extremes),
// the same frames rendered twice must match, and a contact sheet (face box drawn) for Claude to look at.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveProps, resolveTokens, validateComponentManifest, type ComponentManifest, type Style} from '@motionable/plan';
import {MC_RUNTIME, componentCss, tokenFonts} from '@motionable/compose';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
const DUR = 4; // s: every test page
const TIMES = [0.5, 1.5, 2.5, 3.5];

/** Things a component may not do (rule 1): every frame must be a function of time alone. */
const FORBIDDEN: [RegExp, string][] = [
  [/Date\.now|new Date\(|performance\.now/, 'reads the clock'],
  [/getRandomValues|randomUUID/, 'crypto randomness (use ctx.random(seed))'],
  [/Math\.random/, 'Math.random (use ctx.random(seed))'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'timers or animation frames'],
  [/fetch\(|XMLHttpRequest|WebSocket|import\(/, 'network or dynamic import'],
  [/\beval\(|new Function\(/, 'eval'],
  [/repeat\s*:\s*-1/, 'endless repeat (repeat: -1)'],
  [/\.play\(\)|\.pause\(\)|currentTime\s*=/, 'plays, pauses or seeks media'],
  [/localStorage|sessionStorage|document\.cookie/, 'browser storage'],
];

export const staticChecks = (source: string, ref: string) => {
  const errors: string[] = [];
  for (const [re, what] of FORBIDDEN) if (re.test(source)) errors.push(`static: ${what}`);
  if (!source.includes(`MC.define('${ref}'`) && !source.includes(`MC.define("${ref}"`)) errors.push(`static: must call MC.define('${ref}', …)`);
  return errors;
};

// Uzbek samples: the apostrophe letters, a long word, and a line that must wrap
const UZ = {short: 'Oʻzbekiston', words: 'Gʻildirak maʼlumot oʻz vaqtida', long: 'Toshkentdagi eng kattakon ulgurji bozorlardan birida oʻtkazilgan tadqiqot natijalari'};

type Case = {name: string; props: Record<string, unknown>; ctx: Record<string, unknown>};

/** Test cases per kind: defaults, Uzbek text in every text prop, the longest text, and numbers at min and max. */
export const cases = (m: ComponentManifest): Case[] => {
  const texts = Object.entries(m.props).filter(([, s]) => s.type === 'text').map(([k]) => k);
  const nums = Object.entries(m.props).filter(([, s]) => (s.type === 'number' || s.type === 'integer') && s.min !== undefined && s.max !== undefined);
  const withText = (t: string) => Object.fromEntries(texts.map((k) => [k, t]));
  const words = (line: string, from: number) => line.split(' ').map((text, i) => ({text, start: +(from + i * 0.32).toFixed(2), end: +(from + i * 0.32 + 0.28).toFixed(2)}));
  const captionCtx = (lines: string[]) => {
    let t = 0.2;
    return {lines: lines.map((l, i) => {
      const ws = words(l, t);
      t = ws[ws.length - 1].end + 0.15;
      return {id: `l${i}`, role: 'cap', words: ws};
    })};
  };
  const out: Case[] = [];
  if (m.kind === 'caption') {
    out.push({name: 'uzbek', props: {}, ctx: captionCtx([UZ.short, UZ.words])});
    out.push({name: 'long', props: {}, ctx: captionCtx([UZ.long])});
    // the block placed right under the face, as resolve places it when the zone would cover the face
    out.push({name: 'face', props: {}, ctx: {...captionCtx([UZ.short, UZ.words]), underFace: true}});
    // a real block holds every line of a shot: the sheet must show one screen at a time, not a stack
    out.push({name: 'many', props: {}, ctx: captionCtx(UZ.long.split(' ').concat(UZ.words.split(' ')))});
  } else {
    out.push({name: 'uzbek', props: withText(UZ.words), ctx: {}});
    if (texts.length) out.push({name: 'long', props: withText(UZ.long), ctx: {}});
  }
  for (const [k, s] of nums) {
    out.push({name: `${k}-min`, props: {...out[0].props, [k]: s.min}, ctx: out[0].ctx});
    out.push({name: `${k}-max`, props: {...out[0].props, [k]: s.max}, ctx: out[0].ctx});
  }
  return out;
};

const sh = (cmd: string, args: string[], cwd: string) => new Promise<{code: number; out: string; err: string}>((resolve) => {
  const p = spawn(cmd, args, {cwd, env: {...process.env, HYPERFRAMES_NO_TELEMETRY: '1'}});
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({code: code ?? 1, out, err}));
});
const hf = (args: string[], cwd: string) => sh(path.join(REPO, 'node_modules', '.bin', 'hyperframes'), args, cwd);

// the test face, as fractions of the canvas height (its box is drawn on every page)
const FACE = {top: 0.23, bottom: 0.37};
// Captions never cover the face: on every seek, any visible caption text that overlaps the face box is an error
// (a page error, which hyperframes check reports). Visible = the product of the ancestors' opacity above 5 %.
const FACE_CHECK = `window.addEventListener('hf-seek', (e) => {
  const face = document.getElementById('face').getBoundingClientRect();
  const root = document.getElementById('inst');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    let o = 1;
    for (let el = n.parentElement; el && el !== document.body; el = el.parentElement) o *= Number(getComputedStyle(el).opacity);
    if (o < 0.05) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.right > face.left && r.left < face.right && r.bottom > face.top && r.top < face.bottom) {
        throw new Error('caption text covers the face: "' + n.textContent.trim().slice(0, 30) + '" at ' + e.detail.time.toFixed(2) + ' s');
      }
    }
  }
});`;

/** One test page: a grey canvas with a face box drawn, the component mounted over the whole 4 s. */
const testPage = (style: Style, m: ComponentManifest, ref: string, c: Case, css: string, mount = true) => {
  const {w, h, fps} = style.canvas;
  const tokens = resolveTokens(style.tokens, fps);
  const fonts = tokenFonts(tokens.type);
  const props = resolveProps(m.props, c.props, {tokens: style.tokens, fps, start: 0, asset: (a) => a,
    anchor: (a) => Math.round(Number(/^t:([\d.]+)$/.exec(a)?.[1] ?? 0) * fps)});
  const timed = Object.fromEntries(Object.entries(props).map(([k, v]) =>
    [k, typeof v === 'number' && ['anchor', 'duration'].includes(m.props[k]?.type) ? +(v / fps).toFixed(4) : v]));
  const start = 0.2;
  const end = DUR - 0.2;
  const lines = (c.ctx.lines as {role: string}[] | undefined)?.map((l) => ({...l, style: tokens.type[l.role] ?? Object.values(tokens.type)[0]}));
  // caption blocks sit at y (their centre); under the face it's the face's bottom + the face margin + half the block
  const sizes = (lines ?? []).map((l) => l.style.size).sort((a, b) => b - a);
  const y = c.ctx.underFace ? Math.round(h * FACE.bottom + (style.tokens.safe?.face ?? 40) + ((sizes[0] ?? 0) + (sizes[1] ?? 0)) * 1.15 / 2) : Math.round(h * 0.62);
  const {underFace: _, ...ctx} = c.ctx;
  const inst = {id: 'inst', ref, kind: m.kind, start, end, props: timed,
    ctx: {...ctx, ...(lines ? {lines} : {}), ...(m.kind === 'transition' ? {cut: DUR / 2} : {}), y}};
  const page = {canvas: {w, h}, fps, tokens,
    source: {w, h}, cam: [[1, 0, 0]], face: [[0.5, 0.3, 0.22, 0.14]], seen: [1]};
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="${GSAP}"></script><script>${MC_RUNTIME}</script><style data-mc="${ref}">${css}</style><script src="component.js"></script>
<style>html,body{margin:0;background:#000}#root{position:absolute;inset:0;overflow:hidden;background:linear-gradient(160deg,#5b5f66,#2d3036)}
#fx{position:absolute;inset:0}
#face{position:absolute;left:${w * 0.39}px;top:${h * FACE.top}px;width:${w * 0.22}px;height:${h * (FACE.bottom - FACE.top)}px;border:3px solid rgba(80,200,255,.6);border-radius:50%}
.mc{position:absolute;left:0;top:0;width:${w}px;height:${h}px}
${fonts.css}</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${DUR}" data-width="${w}" data-height="${h}" data-fps="${fps}">
${fonts.html}<div id="fx"></div><div id="face"></div>
<div id="inst" class="clip mc" data-start="${start}" data-duration="${+(end - start).toFixed(4)}" data-track-index="1"></div>
</div>
${m.kind === 'caption' ? `<script>${FACE_CHECK}</script>` : ''}
<script>const PAGE=${JSON.stringify(page)};const tl=gsap.timeline({paused:true});${mount ? `MC.mount(${JSON.stringify(inst)},PAGE,tl);` : ''}tl.set({},{},${DUR});
window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;</script></body></html>`;
};

const snap = async (dir: string, out: string) => {
  const r = await hf(['snapshot', '--at', TIMES.join(','), '--no-end', '--output', out], dir);
  if (r.code !== 0) throw new Error(`snapshot failed: ${(r.err || r.out).slice(-400)}`);
  return fs.readdirSync(out).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(out, f));
};
const hash = (f: string) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

export type GateReport = {ref: string; pass: boolean; errors: string[]; warnings: string[]; cases: string[]; sheet?: string; at: string};

/** Runs the gate on styles/<style>/components/<name>/<v>/; writes gate-report.json and, on a pass, status private. */
export const runGate = async (dir: string, style: Style, work: string): Promise<GateReport> => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')) as ComponentManifest;
  const ref = `${manifest.name}@${manifest.version}`;
  const source = fs.readFileSync(path.join(dir, 'component.js'), 'utf8');
  const errors = [...validateComponentManifest(manifest).map((i) => `manifest: ${i.message}`), ...staticChecks(source, ref)];
  const warnings: string[] = [];
  const sheets: string[] = [];
  const list = cases(manifest);
  let css = '';
  let blank: string[] | undefined;
  if (!errors.length) {
    try {
      css = componentCss(source, ref);
    } catch (e) {
      errors.push(`static: the script fails to load: ${String((e as Error).message).slice(0, 200)}`);
    }
  }
  if (!errors.length) {
    fs.rmSync(work, {recursive: true, force: true});
    for (const c of list) {
      const page = path.join(work, c.name);
      fs.mkdirSync(page, {recursive: true});
      fs.copyFileSync(path.join(dir, 'component.js'), path.join(page, 'component.js'));
      fs.writeFileSync(path.join(page, 'index.html'), testPage(style, manifest, ref, c, css));
      const check = await hf(['check', '--json'], page);
      try {
        const j = JSON.parse(check.out) as Record<string, {findings?: {code?: string; severity?: string; message?: string}[]}>;
        for (const [section, v] of Object.entries(j)) {
          for (const f of v?.findings ?? []) {
            const line = `${c.name}: ${section}: ${f.code ?? ''} ${String(f.message ?? '').split('\n')[0].slice(0, 180)}`.replace(/\s+/g, ' ');
            if (f.severity === 'error' && !errors.some((x) => x.split(' at ')[0] === line.split(' at ')[0])) errors.push(line);
            // craft findings judge a whole film (thumbnail, pacing), not one component on a test page
            else if (f.severity === 'warning' && f.code !== 'sweep_static' && section !== 'craft') warnings.push(line);
          }
        }
      } catch {
        errors.push(`${c.name}: check failed: ${(check.err || check.out).slice(-300)}`);
        continue;
      }
      try {
        const a = await snap(page, path.join(page, 'snap-a'));
        const b = await snap(page, path.join(page, 'snap-b'));
        a.forEach((f, i) => { if (!b[i] || hash(f) !== hash(b[i])) errors.push(`${c.name}: frame at ${TIMES[i]} s differs between two renders (not deterministic)`); });
        if (!blank) {
          const bp = path.join(work, '_blank');
          fs.mkdirSync(bp, {recursive: true});
          fs.copyFileSync(path.join(dir, 'component.js'), path.join(bp, 'component.js'));
          fs.writeFileSync(path.join(bp, 'index.html'), testPage(style, manifest, ref, c, css, false));
          blank = (await snap(bp, path.join(bp, 'snap'))).map(hash);
        }
        if (a.every((f, i) => hash(f) === blank![i])) errors.push(`${c.name}: draws nothing (every frame equals the empty page)`);
        sheets.push(path.join(page, 'snap-a', 'contact-sheet.jpg'));
      } catch (e) {
        errors.push(`${c.name}: ${(e as Error).message}`);
      }
    }
  }
  // one sheet for Claude: every case, a row each
  let sheet: string | undefined;
  if (sheets.length) {
    sheet = path.join(dir, 'gate-sheet.jpg');
    const inputs = sheets.flatMap((s) => ['-i', s]);
    const filter = sheets.map((_, i) => `[${i}]scale=1200:-2[s${i}]`).join(';') + ';' + sheets.map((_, i) => `[s${i}]`).join('') + `vstack=inputs=${sheets.length}`;
    const r = await sh('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', sheets.length > 1 ? filter : '[0]scale=1200:-2', '-q:v', '6', sheet], dir);
    if (r.code !== 0) warnings.push(`sheet: ${r.err.slice(-200)}`);
  }
  const report: GateReport = {ref, pass: !errors.length, errors, warnings, cases: list.map((c) => c.name), sheet, at: new Date().toISOString()};
  fs.writeFileSync(path.join(dir, 'gate-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.pass && manifest.status === 'draft') {
    manifest.status = 'private';
    fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  return report;
};
