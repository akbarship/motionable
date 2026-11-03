// Plan → page: resolve the project's plan, conform the base clip (cached by its spans), write the HyperFrames page.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {resolvePlan} from '@motionable/plan';
import {HOME, loadJob, styleDir} from '@motionable/plan/store';
import {conformBase} from '@motionable/engine';
import {compose, componentCss} from '@motionable/compose';
import {baseOf, pruneBases, writeIfChanged} from './pagefiles';

/** Builds <project>/render/page/ (index.html + assets/) for the current plan version; returns its folder, and whether
 * the page changed (a note or a lesson doesn't: the player needn't reload). */
export const buildPage = async (dir: string, home = HOME) => {
  const job = loadJob(dir, home);
  const r = resolvePlan({plan: job.plan, ...job.ctx});
  const page = path.join(dir, 'render', 'page');
  fs.mkdirSync(path.join(page, 'assets'), {recursive: true});
  // the base clip only changes when the kept spans do
  const spans = r.segments.map((g) => ({srcIn: g.srcIn, len: g.len}));
  const key = crypto.createHash('sha1').update(JSON.stringify([r.source.src, spans, r.canvas.fps])).digest('hex').slice(0, 12);
  const base = `assets/base-${key}.mp4`;
  // a new base is made beside the old one (an open page still plays the old one until it reloads)
  if (!fs.existsSync(path.join(page, base))) {
    await conformBase(path.join(dir, r.source.src), spans, r.canvas.fps, path.join(page, base), path.join(dir, 'cache', 'pieces'));
  }
  // b-roll clips next to the page (already conformed on upload), linked when possible
  for (const s of r.shots) {
    if (!s.broll) continue;
    const rel = `assets/broll/${path.basename(s.broll.src)}`;
    const to = path.join(page, rel);
    if (!fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), {recursive: true});
      try {
        fs.linkSync(path.join(dir, s.broll.src), to);
      } catch {
        fs.copyFileSync(path.join(dir, s.broll.src), to);
      }
    }
    s.broll.src = rel;
  }
  // sounds (effects, music) next to the page, the same way
  const placeAudio = (src: string) => {
    const rel = `assets/audio/${path.basename(src)}`;
    const to = path.join(page, rel);
    if (!fs.existsSync(to)) {
      fs.mkdirSync(path.dirname(to), {recursive: true});
      try {
        fs.linkSync(path.join(dir, src), to);
      } catch {
        fs.copyFileSync(path.join(dir, src), to);
      }
    }
    return rel;
  };
  for (const x of r.sfx) x.src = placeAudio(x.src);
  if (r.audio.music) r.audio.music.src = placeAudio(r.audio.music.src);
  // the style's component scripts, copied next to the page (published versions never change, so copy once)
  const scripts: Record<string, string> = {};
  const css: Record<string, string> = {};
  fs.mkdirSync(path.join(page, 'assets', 'components'), {recursive: true});
  for (const ref of Object.keys(job.ctx.components)) {
    const [name, version] = ref.split('@');
    const src = path.join(styleDir(job.plan.style, home), 'components', name, version, 'component.js');
    if (!fs.existsSync(src)) continue;
    const rel = `assets/components/${ref}.js`;
    fs.copyFileSync(src, path.join(page, rel));
    scripts[ref] = rel;
    css[ref] = componentCss(fs.readFileSync(src, 'utf8'), ref);
  }
  const index = path.join(page, 'index.html');
  const before = fs.existsSync(index) ? baseOf(fs.readFileSync(index, 'utf8')) : null;
  const changed = writeIfChanged(index, compose({plan: r, base, manifests: job.ctx.components, scripts, css}));
  pruneBases(path.join(page, 'assets'), [path.basename(base), before]);
  return {page, version: r.version, frames: r.totalFrames, changed};
};
