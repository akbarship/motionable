// Setup for Claude's onboarding (skills/motionable/references/onboarding.md): Node builtins only, so it runs before
// npm install. `npm run setup` prints what's ready and the next step as one compact JSON line.
// `npm run setup -- --home <absolute folder> --lang uz|en` saves the data folder and language to <state>/config.json.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = process.env.MOTIONABLE_STATE ?? path.join(os.homedir(), '.motionable');
const configFile = path.join(state, 'config.json');
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch {
    return {};
  }
};
const sh = (bin, args, timeout = 15000) => {
  const r = spawnSync(bin, args, {encoding: 'utf8', timeout, shell: process.platform === 'win32'});
  return {ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()};
};

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Save the data folder and the language; the same rules as the Studio's Settings. */
export const save = ({home, lang}) => {
  const c = readConfig();
  if (home !== undefined) {
    const h = home.trim().replace(/^~(?=$|[/\\])/, os.homedir());
    if (!path.isAbsolute(h)) throw new Error('the data folder must be an absolute path');
    fs.mkdirSync(h, {recursive: true});
    c.home = h;
  }
  if (lang !== undefined) {
    if (lang !== 'uz' && lang !== 'en') throw new Error('lang is uz or en');
    c.lang = lang;
  }
  fs.mkdirSync(state, {recursive: true});
  fs.writeFileSync(configFile, JSON.stringify(c, null, 2));
  return c;
};

/** What's ready, in onboarding order; `next` is the first thing missing. Never prints a key. */
export const check = () => {
  const c = readConfig();
  const major = Number(process.versions.node.split('.')[0]);
  const home = c.home ?? process.env.MOTIONABLE_HOME ?? path.join(os.homedir(), 'Motionable');
  let daemon = null;
  try {
    daemon = JSON.parse(fs.readFileSync(path.join(state, 'daemon.json'), 'utf8'));
  } catch {}
  const s = {
    node: {ok: major >= 22, version: process.versions.node},
    ffmpeg: sh('ffmpeg', ['-version']).ok,
    ffprobe: sh('ffprobe', ['-version']).ok,
    lang: c.lang ?? null,
    home: {path: home, chosen: !!c.home, exists: fs.existsSync(home)},
    deps: fs.existsSync(path.join(repo, 'node_modules', '.bin', 'tsx')),
    studio: fs.existsSync(path.join(repo, 'apps', 'studio', 'dist', 'index.html')),
    elevenlabs: !!c.keys?.elevenlabs,
    // a running daemon reads the folder only when it starts
    restart: !!daemon && !!c.home && path.resolve(daemon.home ?? '') !== path.resolve(c.home),
  };
  const steps = [
    [!s.node.ok, 'install Node.js 22 or newer'],
    [!s.lang, 'ask the language, then: npm run setup -- --lang uz|en'],
    [!s.ffmpeg || !s.ffprobe, 'install ffmpeg (with ffprobe)'],
    [!s.deps, 'npm install'],
    [!s.studio, 'npm run build'],
    [!s.home.chosen, 'ask where videos live, then: npm run setup -- --home <folder>'],
    [s.restart, 'restart the Motionable server (npm start)'],
    [!s.elevenlabs, 'optional: the ElevenLabs key in Studio ⚙ Settings'],
  ];
  s.next = steps.find(([missing]) => missing)?.[1] ?? 'done: call wait_for_studio';
  return s;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (arg('home') !== undefined || arg('lang') !== undefined) save({home: arg('home'), lang: arg('lang')});
    console.log(JSON.stringify(check()));
  } catch (e) {
    console.error(JSON.stringify({error: e.message}));
    process.exit(1);
  }
}
