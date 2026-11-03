// Setup for Claude's onboarding (skills/motionable/references/onboarding.md): Node builtins only, so it runs before
// npm install. `npm run setup` prints what's ready and the next step as one compact JSON line.
// `npm run setup -- --home <absolute folder> --lang uz|en` saves the data folder and language to <state>/config.json.
// `--ffmpeg` downloads static ffmpeg + ffprobe into <state>/bin (no sudo, no Homebrew); `--restart` restarts the server.
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
const EXE = process.platform === 'win32' ? '.exe' : '';
const binDir = path.join(state, 'bin');
/** The installer's copy first (the same order as packages/engine/src/bin.ts), then PATH. */
const tool = (name) => (fs.existsSync(path.join(binDir, name + EXE)) ? path.join(binDir, name + EXE) : name);
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

// static builds: johnvansickle (Linux), gyan.dev essentials (Windows), Martin Riedl (macOS, Intel and Apple silicon)
const FFMPEG = {
  linux: {x64: ['https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'],
    arm64: ['https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz']},
  win32: {x64: ['https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip']},
  darwin: Object.fromEntries(['x64', 'arm64'].map((a) => [a, ['ffmpeg', 'ffprobe'].map((n) =>
    `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${a === 'x64' ? 'amd64' : 'arm64'}/release/${n}.zip`)])),
};
const find = (dir, name) => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = find(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
  return null;
};
/** Download and unpack ffmpeg + ffprobe into <state>/bin. tar unpacks .tar.xz and (Windows 10+, macOS) .zip. */
export const installFfmpeg = async () => {
  const urls = FFMPEG[process.platform]?.[process.arch];
  if (!urls) throw new Error(`no static ffmpeg for ${process.platform}-${process.arch}: install it with your package manager`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motionable-ffmpeg-'));
  try {
    for (const [i, url] of urls.entries()) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`download failed (${r.status}): ${url}`);
      const file = path.join(tmp, `${i}-${path.basename(new URL(r.url).pathname)}`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      const x = spawnSync('tar', ['-xf', file, '-C', tmp], {encoding: 'utf8'});
      if (x.status !== 0) throw new Error(`unpacking failed: ${x.stderr}`);
    }
    fs.mkdirSync(binDir, {recursive: true});
    for (const name of ['ffmpeg', 'ffprobe']) {
      const f = find(tmp, name + EXE);
      if (!f) throw new Error(`${name} wasn't in the download`);
      fs.copyFileSync(f, path.join(binDir, name + EXE));
      fs.chmodSync(path.join(binDir, name + EXE), 0o755);
    }
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
};

/** Linux only: system libraries the renderer's Chrome needs but can't find (empty when all are there). */
const chromeLibs = () => {
  if (process.platform !== 'linux') return [];
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  if (!fs.existsSync(cache)) return [];
  const bin = find(cache, 'chrome-headless-shell');
  if (!bin) return [];
  const r = spawnSync('ldd', [bin], {encoding: 'utf8'});
  return [...(r.stdout ?? '').matchAll(/^\s*(\S+) => not found/gm)].map((m) => m[1]);
};

/** Ask the running server to restart itself (it reads the data folder only when it starts). */
const restart = async () => {
  const d = JSON.parse(fs.readFileSync(path.join(state, 'daemon.json'), 'utf8'));
  await fetch(`http://127.0.0.1:${d.port}/api/restart`, {method: 'POST'});
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
    ffmpeg: sh(tool('ffmpeg'), ['-version']).ok,
    ffprobe: sh(tool('ffprobe'), ['-version']).ok,
    lang: c.lang ?? null,
    home: {path: home, chosen: !!c.home, exists: fs.existsSync(home)},
    deps: fs.existsSync(path.join(repo, 'node_modules', 'tsx', 'package.json')) && fs.existsSync(path.join(repo, 'node_modules', 'hyperframes')),
    studio: fs.existsSync(path.join(repo, 'apps', 'studio', 'dist', 'index.html')),
    chromeLibs: chromeLibs(),
    elevenlabs: !!c.keys?.elevenlabs,
    // a running daemon reads the folder only when it starts
    restart: !!daemon && !!c.home && path.resolve(daemon.home ?? '') !== path.resolve(c.home),
  };
  const steps = [
    [!s.node.ok, 'install Node.js 22 or newer'],
    [!s.lang, 'ask the language, then: npm run setup -- --lang uz|en'],
    [!s.ffmpeg || !s.ffprobe, 'npm run setup -- --ffmpeg (downloads ffmpeg, ~80 MB, no admin rights)'],
    [!s.deps, 'npm install'],
    [!s.studio, 'npm run build'],
    [!s.home.chosen, 'ask where videos live, then: npm run setup -- --home <folder>'],
    [s.chromeLibs.length > 0, `the renderer's Chrome misses system libraries (${s.chromeLibs.join(', ')}): the user runs \`sudo npx puppeteer browsers install chrome-headless-shell --install-deps\` in their own terminal`],
    [s.restart, 'npm run setup -- --restart'],
    [!s.elevenlabs, 'optional: the ElevenLabs key in Studio ⚙ Settings'],
  ];
  s.next = steps.find(([missing]) => missing)?.[1] ?? 'done: call wait_for_studio';
  return s;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (arg('home') !== undefined || arg('lang') !== undefined) save({home: arg('home'), lang: arg('lang')});
    if (process.argv.includes('--ffmpeg')) await installFfmpeg();
    if (process.argv.includes('--restart')) await restart();
    console.log(JSON.stringify(check()));
  } catch (e) {
    console.error(JSON.stringify({error: e.message}));
    process.exit(1);
  }
}
