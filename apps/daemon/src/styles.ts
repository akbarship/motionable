// Styles: the user's own design systems. References are studied first (rule 1), then Claude saves the style and
// writes its components, each one gated. Folders: styles/<name>/refs/<id>.* and styles/<name>/<version>/.
import fs from 'node:fs';
import path from 'node:path';
import {validateComponentManifest, validateStyleDoc, type ComponentManifest, type Style} from '@motionable/plan';
import {HOME, readJson, styleDir, writeJson} from '@motionable/plan/store';
import {studyReference, type ReferenceStudy} from '@motionable/engine';
import {runGate} from '@motionable/gate';
import {slug} from './analyze';

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BRIEF_MAX_LINES = 30;

export const stylesDir = (home = HOME) => path.join(home, 'styles');
const refsDir = (name: string, home = HOME) => {
  if (!NAME.test(name)) throw new Error(`bad style name "${name}": lowercase letters, digits and dashes`);
  return path.join(stylesDir(home), name, 'refs');
};

export const listStyles = (home = HOME) => {
  const root = stylesDir(home);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((n) => NAME.test(n)).map((name) => {
    const versions = fs.readdirSync(path.join(root, name)).filter((v) => /^\d+$/.test(v) && fs.existsSync(path.join(root, name, v, 'style.json')))
      .map(Number).sort((a, b) => a - b);
    const refs = fs.existsSync(path.join(root, name, 'refs')) ? fs.readdirSync(path.join(root, name, 'refs')).filter((f) => f.endsWith('.study.json')).length : 0;
    const last = versions.at(-1);
    const comps = last ? componentList(`${name}@${last}`, home) : [];
    return {name, versions, refs, components: comps.map((c) => `${c.ref} ${c.status}`)};
  });
};

const componentList = (ref: string, home = HOME) => {
  const dir = path.join(styleDir(ref, home), 'components');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).flatMap((n) => fs.readdirSync(path.join(dir, n)).filter((v) => fs.existsSync(path.join(dir, n, v, 'component.json')))
    .map((v) => ({ref: `${n}@${v}`, status: readJson<ComponentManifest>(path.join(dir, n, v, 'component.json')).status})));
};

/** Copy reference reels into the style and measure them; the answer is compact, pictures come through `look`. */
export const addReferences = async (name: string, files: string[], home = HOME) => {
  const dir = refsDir(name, home);
  fs.mkdirSync(dir, {recursive: true});
  const out: (Omit<ReferenceStudy, 'sheetTimes' | 'cuts'> & {id: string; cuts: number})[] = [];
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`file not found: ${f}`);
    let id = slug(f);
    for (let n = 2; fs.existsSync(path.join(dir, `${id}.study.json`)); n++) id = `${slug(f)}-${n}`;
    const file = path.join(dir, `${id}${path.extname(f).toLowerCase()}`);
    fs.copyFileSync(f, file, fs.constants.COPYFILE_FICLONE);
    const s = await studyReference(file, path.join(dir, `${id}.sheet.jpg`));
    writeJson(path.join(dir, `${id}.study.json`), {...s, id, source: path.basename(f)});
    out.push({id, file: s.file, durationS: s.durationS, w: s.w, h: s.h, fps: s.fps, cuts: s.cuts.length, cutsPerMin: s.cutsPerMin, avgShotS: s.avgShotS, pacing: s.pacing});
  }
  return out;
};

export const referenceFile = (name: string, id: string, home = HOME) => {
  const dir = refsDir(name, home);
  const f = fs.readdirSync(dir).find((x) => x.startsWith(`${id}.`) && !x.endsWith('.json') && !x.endsWith('.jpg'));
  if (!f) throw new Error(`no reference ${id} in style ${name}`);
  return {file: path.join(dir, f), sheet: path.join(dir, `${id}.sheet.jpg`), study: readJson<ReferenceStudy>(path.join(dir, `${id}.study.json`))};
};

/** Save a style version. It must name the studied references it was learned from. */
export const saveStyle = (doc: Style, brief: string, home = HOME) => {
  const issues = validateStyleDoc(doc).map((i) => i.message);
  if (issues.length) throw new Error(`invalid style:\n${issues.slice(0, 12).join('\n')}`);
  const studied = fs.existsSync(path.join(stylesDir(home), doc.name, 'refs'))
    ? fs.readdirSync(path.join(stylesDir(home), doc.name, 'refs')).filter((f) => f.endsWith('.study.json')).map((f) => f.slice(0, -11)) : [];
  if (!studied.length) throw new Error('study the references first (study_reference): a style is learned from them');
  const refs = doc.refs ?? [];
  const unknown = refs.filter((r) => !studied.includes(r));
  if (!refs.length || unknown.length) throw new Error(`"refs" must list the studied references it was learned from (${studied.join(', ')})${unknown.length ? `; unknown: ${unknown.join(', ')}` : ''}`);
  const lines = brief.trim().split('\n').length;
  if (lines > BRIEF_MAX_LINES) throw new Error(`brief.md is ${lines} lines; keep it to ${BRIEF_MAX_LINES}`);
  const dir = styleDir(`${doc.name}@${doc.version}`, home);
  const file = path.join(dir, 'style.json');
  if (fs.existsSync(file) && readJson<Style>(file).status === 'public') throw new Error(`${doc.name}@${doc.version} is public: save a new version`);
  writeJson(file, {...doc, madeFrom: {...doc.madeFrom, kind: 'reference'}});
  fs.writeFileSync(path.join(dir, 'brief.md'), brief.trim() + '\n');
  // what's missing, so Claude knows what to write next
  const have = new Set(componentList(`${doc.name}@${doc.version}`, home).map((c) => c.ref));
  const wanted = Object.values(doc.components).flatMap((v) => (Array.isArray(v) ? v : [v.component]));
  return {ref: `${doc.name}@${doc.version}`, missingComponents: [...new Set(wanted)].filter((c) => !have.has(c))};
};

/** Write a component's two files and gate it. Public components never change: a change is a new version. */
export const writeComponent = async (styleRef: string, manifest: ComponentManifest, code: string, home = HOME) => {
  const issues = validateComponentManifest({...manifest, status: 'draft'}).map((i) => i.message);
  if (issues.length) throw new Error(`invalid component.json:\n${issues.slice(0, 12).join('\n')}`);
  const style = readJson<Style>(path.join(styleDir(styleRef, home), 'style.json'));
  const dir = path.join(styleDir(styleRef, home), 'components', manifest.name, String(manifest.version));
  if (fs.existsSync(path.join(dir, 'component.json')) && readJson<ComponentManifest>(path.join(dir, 'component.json')).status === 'public') {
    throw new Error(`${manifest.name}@${manifest.version} is public: write version ${manifest.version + 1}`);
  }
  fs.mkdirSync(dir, {recursive: true});
  writeJson(path.join(dir, 'component.json'), {...manifest, status: 'draft'});
  fs.writeFileSync(path.join(dir, 'component.js'), code);
  const report = await runGate(dir, style, path.join(home, '.cache', 'gate', styleRef, manifest.name));
  return {...report, sheet: report.sheet && fs.existsSync(report.sheet) ? report.sheet : undefined};
};

/** One style for the Studio's card: style.json, the brief, its references (study + sheet), its components (status,
 * gate result, sheet) as file paths relative to styles/<name>/, which the daemon serves. */
export const styleDetail = (ref: string, home = HOME) => {
  const [name] = ref.split('@');
  const root = path.join(stylesDir(home), name);
  const dir = styleDir(ref, home);
  if (!fs.existsSync(path.join(dir, 'style.json'))) throw new Error(`no style ${ref}`);
  const rel = (f: string) => path.relative(root, f);
  const refs = refsDir(name, home);
  const studies = fs.existsSync(refs) ? fs.readdirSync(refs).filter((f) => f.endsWith('.study.json')).sort() : [];
  const components = componentList(ref, home).map(({ref: c}) => {
    const [cn, cv] = c.split('@');
    const cdir = path.join(dir, 'components', cn, cv);
    const m = readJson<ComponentManifest>(path.join(cdir, 'component.json'));
    const report = fs.existsSync(path.join(cdir, 'gate-report.json'))
      ? readJson<{pass: boolean; errors: string[]; at: string; cases: string[]}>(path.join(cdir, 'gate-report.json')) : null;
    return {ref: c, kind: m.kind, title: m.title, description: m.description, status: m.status,
      gate: report ? {pass: report.pass, at: report.at, cases: report.cases.length, errors: report.errors.slice(0, 3)} : null,
      sheet: fs.existsSync(path.join(cdir, 'gate-sheet.jpg')) ? rel(path.join(cdir, 'gate-sheet.jpg')) : null};
  });
  return {
    ref,
    style: readJson<Style>(path.join(dir, 'style.json')),
    brief: fs.existsSync(path.join(dir, 'brief.md')) ? fs.readFileSync(path.join(dir, 'brief.md'), 'utf8') : '',
    refs: studies.map((f) => {
      const s = readJson<ReferenceStudy & {id: string; source?: string}>(path.join(refs, f));
      return {id: s.id, source: s.source, durationS: s.durationS, cuts: s.cuts.length, cutsPerMin: s.cutsPerMin, avgShotS: s.avgShotS, pacing: s.pacing,
        sheet: fs.existsSync(path.join(refs, `${s.id}.sheet.jpg`)) ? rel(path.join(refs, `${s.id}.sheet.jpg`)) : null};
    }),
    components,
  };
};

/** References a style has studied but no version yet (the Studio shows them while Claude builds the style). */
export const pendingRefs = (name: string, home = HOME) => {
  const refs = refsDir(name, home);
  return fs.existsSync(refs) ? fs.readdirSync(refs).filter((f) => f.endsWith('.study.json')).map((f) => f.slice(0, -11)) : [];
};
