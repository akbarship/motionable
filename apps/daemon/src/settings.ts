// Settings: the user's keys, language and data folder in <state>/config.json. Keys never leave the daemon in full:
// the Studio sees them masked.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HOME, STATE, readJson, writeJson} from '@motionable/plan/store';

const VERSION = readJson<{version: string}>(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json')).version;

// ElevenLabs: transcripts (paid). Pexels and Pixabay: stock b-roll (free keys).
const KEYS = ['elevenlabs', 'pexels', 'pixabay'] as const;

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
    version: VERSION,
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
