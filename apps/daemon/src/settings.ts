// Settings: the user's keys, language and data folder in <state>/config.json, plus the Claude Code connection (is
// the CLI there, is the motionable MCP added). Keys never leave the daemon in full: the Studio sees them masked.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HOME, STATE, readJson, writeJson} from '@motionable/plan/store';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KEYS = ['elevenlabs', 'gemini'] as const;

export type Config = {keys?: Partial<Record<(typeof KEYS)[number], string>>; lang?: 'uz' | 'en'; home?: string};

export const configFile = (state = STATE) => path.join(state, 'config.json');
export const readConfig = (state = STATE): Config => {
  try {
    return readJson<Config>(configFile(state));
  } catch {
    return {};
  }
};

/** A key as the Studio may show it: the last 4 characters only. */
export const mask = (key: string | undefined) => (key ? `••••${key.slice(-4)}` : null);

export const publicSettings = (state = STATE) => {
  const c = readConfig(state);
  return {
    keys: Object.fromEntries(KEYS.map((k) => [k, mask(c.keys?.[k])])),
    lang: c.lang ?? 'uz',
    home: c.home ?? HOME,
    restart: !!c.home && path.resolve(c.home) !== path.resolve(HOME), // the daemon reads the folder when it starts
  };
};

/** Merge a change: a key set to "" or null is removed; unknown fields are ignored. */
export const saveSettings = (change: {keys?: Record<string, string | null>; lang?: string; home?: string}, state = STATE) => {
  const c = readConfig(state);
  const keys = {...c.keys};
  for (const k of KEYS) {
    const v = change.keys?.[k];
    if (v === undefined) continue;
    if (v === null || !v.trim()) delete keys[k];
    else keys[k] = v.trim();
  }
  const next: Config = {...c, keys};
  if (change.lang === 'uz' || change.lang === 'en') next.lang = change.lang;
  if (typeof change.home === 'string' && change.home.trim()) {
    if (!path.isAbsolute(change.home.trim())) throw new Error('the data folder must be an absolute path');
    next.home = change.home.trim();
  }
  writeJson(configFile(state), next);
  return publicSettings(state);
};

// ---------- Claude Code ----------
const run = (args: string[], timeoutMs = 15000) => new Promise<{code: number | null; out: string}>((resolve) => {
  const p = spawn('claude', args, {stdio: ['ignore', 'pipe', 'pipe'], env: process.env});
  let out = '';
  const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('error', (e) => { clearTimeout(timer); resolve({code: null, out: e.message}); });
  p.on('close', (code) => { clearTimeout(timer); resolve({code, out: out.trim()}); });
});

/** The command that adds the Motionable MCP server to the user's Claude Code (all folders). */
export const mcpAddArgs = () => ['mcp', 'add', '-s', 'user', 'motionable', '--', path.join(REPO, 'node_modules/.bin/tsx'), path.join(REPO, 'apps/mcp/src/main.ts')];

export const claudeCodeStatus = async () => {
  const v = await run(['--version'], 8000);
  if (v.code !== 0) return {cli: false, version: null, mcp: 'unknown', command: `claude ${mcpAddArgs().join(' ')}`};
  const m = await run(['mcp', 'get', 'motionable']);
  const status = /Status:\s*(.+)/.exec(m.out)?.[1]?.trim();
  return {cli: true, version: v.out.split('\n')[0], mcp: m.code === 0 ? (status ?? 'added') : 'missing', command: `claude ${mcpAddArgs().join(' ')}`};
};

export const connectClaudeCode = async () => {
  const r = await run(mcpAddArgs());
  if (r.code !== 0 && !/already exists/i.test(r.out)) throw new Error(r.out.slice(-300) || 'claude mcp add failed');
  return claudeCodeStatus();
};
