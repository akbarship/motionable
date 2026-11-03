// New projects and their analysis. Free steps run on creation; transcription is paid (the user's key) and runs only
// when asked. Every step is timed in analysis/report.json and skipped when its output already exists.
import fs from 'node:fs';
import path from 'node:path';
import type {Brief, JobManifest} from '@motionable/plan';
import {HOME, readJson, writeJson} from '@motionable/plan/store';
import {audioSource, buildSource, contactSheet, elevenLabsKey, loudness, probe, probeMedia, scribe, toTranscript, trackFace, voiceAudio} from '@motionable/engine';
import {projectsDir} from './projects';

const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.3gp']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']);
const MAX_S = 180;

type Step = {status: 'running' | 'done' | 'failed'; seconds?: number; error?: string; [k: string]: unknown};
export type Report = {steps: Record<string, Step>; warnings: string[]; sheetTimes?: number[]; analyzedAt?: string};

export const slug = (name: string) =>
  path.basename(name, path.extname(name)).normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'video';

const reportFile = (dir: string) => path.join(dir, 'analysis', 'report.json');
export const readReport = (dir: string): Report => (fs.existsSync(reportFile(dir)) ? readJson<Report>(reportFile(dir)) : {steps: {}, warnings: []});

const setAsset = (dir: string, id: string, entry: JobManifest['assets'][string]) => {
  const m = readJson<JobManifest>(path.join(dir, 'job.json'));
  m.assets[id] = entry;
  writeJson(path.join(dir, 'job.json'), m);
};

/** The wizard's brief, checked: short enough for Claude to read every time. */
export const checkBrief = (b: unknown): Brief | undefined => {
  if (b === undefined || b === null) return undefined;
  const x = b as Partial<Brief>;
  if (typeof x.about !== 'string' || !x.about.trim()) throw new Error('brief.about is required');
  if (x.mode !== 'edit' && x.mode !== 'voiceover') throw new Error('brief.mode is edit or voiceover');
  if (x.script !== undefined && typeof x.script !== 'string') throw new Error('brief.script is text');
  if ((x.script ?? '').length > 20000 || x.about.length > 2000) throw new Error('the brief is too long');
  return {about: x.about.trim(), mode: x.mode, ...(x.script?.trim() ? {script: x.script.trim()} : {}),
    ...(typeof x.style === 'string' && x.style.trim() ? {style: x.style.trim()} : {})};
};

/** A project folder from the user's files (copied, never moved). Returns its id. */
export const createProject = async (files: string[], opts: {id?: string; title?: string; brief?: Brief} = {}, home = HOME) => {
  if (!files.length) throw new Error('no files');
  const brief = checkBrief(opts.brief);
  const voiceover = brief?.mode === 'voiceover';
  if (voiceover && files.length !== 1) throw new Error('a voiceover takes one audio file');
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`file not found: ${f}`);
    const ext = path.extname(f).toLowerCase();
    if (voiceover ? !AUDIO.has(ext) : !VIDEO.has(ext)) throw new Error(`not ${voiceover ? 'an audio file' : 'a video'}: ${path.basename(f)}`);
    // readable at all? fail before copying anything
    if (voiceover) {
      if (!(await probe(f)).audio) throw new Error(`${path.basename(f)}: no sound`);
    } else await probeMedia(f);
  }
  let id = opts.id ?? slug(files[0]);
  const root = projectsDir(home);
  for (let n = 2; fs.existsSync(path.join(root, id)); n++) id = `${opts.id ?? slug(files[0])}-${n}`;
  const dir = path.join(root, id);
  fs.mkdirSync(path.join(dir, 'input'), {recursive: true});
  const assets: JobManifest['assets'] = {};
  files.forEach((f, i) => {
    const rel = `input/original-${i + 1}${path.extname(f).toLowerCase()}`;
    fs.copyFileSync(f, path.join(dir, rel), fs.constants.COPYFILE_FICLONE);
    assets[`original_${i + 1}`] = {path: rel, kind: voiceover ? 'audio' : 'video', meta: {name: path.basename(f)}};
  });
  writeJson(path.join(dir, 'job.json'), {id, kind: 'job', title: opts.title ?? path.basename(files[0]), createdAt: new Date().toISOString(),
    ...(brief ? {brief} : {}), assets});
  return id;
};

const originals = (dir: string) => {
  const m = readJson<JobManifest>(path.join(dir, 'job.json'));
  return Object.entries(m.assets).filter(([k]) => k.startsWith('original_')).sort(([a], [b]) => Number(a.slice(9)) - Number(b.slice(9)))
    .map(([, a]) => path.join(dir, a.path));
};

export type OnStep = (step: string, status: Step['status']) => void;

const runStep = async (dir: string, report: Report, name: string, fn: (s: Step) => Promise<void>, on?: OnStep) => {
  const t = Date.now();
  const s: Step = {status: 'running'};
  report.steps[name] = s;
  on?.(name, 'running');
  try {
    await fn(s);
    s.status = 'done';
  } catch (e) {
    s.status = 'failed';
    s.error = String((e as Error).message ?? e).slice(-400);
    throw e;
  } finally {
    s.seconds = +((Date.now() - t) / 1000).toFixed(1);
    report.analyzedAt = new Date().toISOString();
    writeJson(reportFile(dir), report);
    on?.(name, s.status);
  }
};

const done = (dir: string, report: Report, name: string, out: string) => report.steps[name]?.status === 'done' && fs.existsSync(path.join(dir, out));

/** Is this project a voiceover (a voice track; no footage, so no contact sheet and no face). */
export const isVoiceover = (dir: string) => readJson<JobManifest>(path.join(dir, 'job.json')).brief?.mode === 'voiceover';

/** The free steps: master source, voice audio, loudness, contact sheet, then plain-language warnings. */
export const analyzeFree = async (dir: string, on?: OnStep) => {
  const report = readReport(dir);
  const voiceover = isVoiceover(dir);
  if (!done(dir, report, 'source', 'input/source.mp4')) {
    await runStep(dir, report, 'source', async (s) => {
      if (voiceover) {
        await audioSource(originals(dir)[0], path.join(dir, 'input/source.mp4'));
        s.changes = ['voiceover: a flat 1080×1920 picture under the voice'];
      } else {
        const {reasons, infos} = await buildSource(originals(dir), path.join(dir, 'input/source.mp4'), path.join(dir, 'cache', 'clips'));
        s.changes = reasons;
        s.originals = infos.map((i) => ({file: i.file, w: i.video.w, h: i.video.h, fps: i.video.fps, hdr: i.video.hdr, vfr: i.video.vfr, durationS: i.duration}));
      }
      const src = await probeMedia(path.join(dir, 'input/source.mp4'));
      setAsset(dir, 'src_main', {path: 'input/source.mp4', kind: 'video', meta: {w: src.video.w, h: src.video.h, fps: src.video.fps, duration: src.duration}});
    }, on);
  }
  if (!done(dir, report, 'voice', 'input/voice.mp3')) {
    await runStep(dir, report, 'voice', async () => {
      await voiceAudio(path.join(dir, 'input/source.mp4'), path.join(dir, 'input/voice.mp3'));
      setAsset(dir, 'voice', {path: 'input/voice.mp3', kind: 'audio'});
    }, on);
  }
  const src = readJson<JobManifest>(path.join(dir, 'job.json')).assets.src_main.meta as {w: number; h: number; duration: number};
  if (report.steps.loudness?.status !== 'done') {
    await runStep(dir, report, 'loudness', async (s) => void Object.assign(s, await loudness(path.join(dir, 'input/source.mp4'))), on);
  }
  if (voiceover) {
    // no footage to look at and no face to follow
    report.steps.sheet = {status: 'done', skipped: 'voiceover'};
    report.steps.track = {status: 'done', noFace: true, skipped: 'voiceover'};
  }
  if (!voiceover && !done(dir, report, 'sheet', 'analysis/contact.jpg')) {
    await runStep(dir, report, 'sheet', async (s) => {
      report.sheetTimes = await contactSheet(path.join(dir, 'input/source.mp4'), path.join(dir, 'analysis/contact.jpg'), src.duration);
      s.tiles = report.sheetTimes.length;
    }, on);
  }
  // the face, for the camera and for captions that stay off it; a video without one just gets no track
  if (!done(dir, report, 'track', 'analysis/track.json') && !(report.steps.track?.status === 'done' && report.steps.track.noFace)) {
    await runStep(dir, report, 'track', async (s) => {
      try {
        const {stats} = await trackFace(path.join(dir, 'input/source.mp4'), path.join(dir, 'analysis/track.json'));
        const prev = Number(readJson<JobManifest>(path.join(dir, 'job.json')).assets.trk_main?.version ?? 0);
        setAsset(dir, 'trk_main', {path: 'analysis/track.json', kind: 'track', version: prev + 1});
        Object.assign(s, stats);
      } catch (e) {
        if (!/no face found/.test(String((e as Error).message))) throw e;
        s.noFace = true;
      }
    }, on);
  }
  report.warnings = warnings(report, src, voiceover);
  writeJson(reportFile(dir), report);
  return report;
};

const warnings = (report: Report, src: {w: number; h: number; duration: number}, voiceover = false) => {
  const out: string[] = [];
  const o = (report.steps.source?.originals ?? []) as {file: string; hdr: boolean; vfr: boolean}[];
  if (o.some((x) => x.hdr)) out.push('HDR original tone-mapped to SDR: check the colours');
  if (o.some((x) => x.vfr)) out.push('variable frame rate converted to constant 30 fps');
  if (Math.min(src.w, src.h) < 1080) out.push(`low resolution (${src.w}×${src.h}): keep zooms small`);
  if (src.w > src.h) out.push('landscape footage: a vertical reel crops it heavily (track mode helps)');
  if (report.steps.track?.noFace && !voiceover) out.push('no face found: the camera stays fixed and captions have nothing to avoid');
  if (src.duration > MAX_S) out.push(`${Math.round(src.duration)} s is long for a reel`);
  const l = report.steps.loudness as {integratedLufs?: number; truePeakDbtp?: number} | undefined;
  if (l?.integratedLufs !== undefined && l.integratedLufs < -30) out.push(`very quiet recording (${l.integratedLufs} LUFS)`);
  if (l?.truePeakDbtp !== undefined && l.truePeakDbtp > -0.1) out.push(`peaks at ${l.truePeakDbtp} dBTP: may be clipped`);
  const t = report.steps.transcribe as {words?: number; lowConfidence?: number; languageDetected?: string} | undefined;
  if (t?.words && t.languageDetected && !['uzb', 'uz'].includes(t.languageDetected)) out.push(`Scribe heard ${t.languageDetected}, not Uzbek`);
  if (t?.words && (t.lowConfidence ?? 0) / t.words > 0.2) out.push(`${t.lowConfidence} of ${t.words} words have low confidence`);
  return out;
};

/** Paid: ElevenLabs Scribe on the user's key. `raw` reuses a Scribe response already paid for (dev seed), no call. */
export const transcribe = async (dir: string, on?: OnStep, raw?: string) => {
  const report = readReport(dir);
  if (done(dir, report, 'transcribe', 'analysis/transcript.json')) return report;
  if (!fs.existsSync(path.join(dir, 'input/voice.mp3'))) throw new Error('run the analysis first (no voice audio yet)');
  await runStep(dir, report, 'transcribe', async (s) => {
    const res = raw ? readJson<Awaited<ReturnType<typeof scribe>>>(raw) : await scribe(path.join(dir, 'input/voice.mp3'), elevenLabsKey());
    writeJson(path.join(dir, 'analysis/transcript.raw.json'), res);
    const {transcript, fixed} = toTranscript(res);
    writeJson(path.join(dir, 'analysis/transcript.json'), transcript);
    const prev = Number(readJson<JobManifest>(path.join(dir, 'job.json')).assets.tr_main?.version ?? 0);
    setAsset(dir, 'tr_main', {path: 'analysis/transcript.json', kind: 'transcript', version: prev + 1});
    const confs = transcript.words.map((w) => w.conf).filter((c): c is number => c !== null);
    Object.assign(s, {model: transcript.provider, words: transcript.words.length, lowConfidence: confs.filter((c) => c < 0.6).length,
      apostrophesFixed: fixed, languageDetected: transcript.languageDetected});
  }, on);
  const src = readJson<JobManifest>(path.join(dir, 'job.json')).assets.src_main.meta as {w: number; h: number; duration: number};
  report.warnings = warnings(report, src, isVoiceover(dir));
  writeJson(reportFile(dir), report);
  return report;
};
