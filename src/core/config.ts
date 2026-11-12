import { join } from 'node:path';
import { home } from './paths.js';
import { readFile } from 'node:fs/promises';
import { writeJson } from './store.js';
import { ConfigSchema, type Config } from './types.js';

const MASK = '••••';
const KINDS = ['image', 'video', 'tts', 'stt'] as const;

type ConfigPatch = Omit<Partial<Config>, 'providers'> & {
  providers?: { [K in (typeof KINDS)[number]]?: Config['providers'][K] };
};

const file = () => join(home(), 'config.json');

function defaults(): Config {
  return ConfigSchema.parse({
    providers: { image: { use: 'off' }, video: { use: 'off' }, tts: { use: 'off' }, stt: { use: 'off' } },
  });
}

const ENV_KEYS = { kie: 'KIE_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' } as const;
const ENV_FOR: Record<(typeof KINDS)[number], keyof typeof ENV_KEYS> = { image: 'kie', video: 'kie', tts: 'elevenlabs', stt: 'elevenlabs' };

/**
 * Env keys fill what the file leaves empty: a kind that is `off` with no stored key turns on with the
 * env provider, and a kind set to that provider without a key gets the env key. Never written to disk.
 */
export function withEnvKeys(c: Config, env: NodeJS.ProcessEnv = process.env): Config {
  const out: Config = { ...c, providers: { ...c.providers } };
  for (const k of KINDS) {
    const prov = ENV_FOR[k];
    const key = env[ENV_KEYS[prov]]?.trim();
    if (!key) continue;
    const p = c.providers[k];
    if (p.key) continue;
    if (p.use === 'off' || p.use === prov) out.providers[k] = { use: prov, key };
  }
  return out;
}

/** Config with env key fallback (what providers use). */
export async function loadConfig(): Promise<Config> {
  return withEnvKeys(await loadStored());
}

/**
 * Missing file -> defaults. A file written by hand or by an older version may lack fields:
 * each missing provider kind falls back to {use:'off'} instead of crashing the Studio.
 */
async function loadStored(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(file(), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw e;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${file()} is not valid JSON; fix or delete it`);
  }
  const base = defaults();
  const given = (data.providers ?? {}) as Partial<Config['providers']>;
  const merged = { ...data, providers: { ...base.providers, ...given } };
  const r = ConfigSchema.safeParse(merged);
  if (!r.success) throw new Error(`${file()} has invalid values: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return r.data;
}

function mask(key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  return key.length < 4 ? MASK : MASK + key.slice(-4);
}

/** Copy of the config safe to show in a UI: every key becomes "••••" + last 4 chars. */
export function maskedConfig(c: Config): Config {
  const out: Config = { ...c, providers: { ...c.providers } };
  for (const k of KINDS) {
    const p = c.providers[k];
    out.providers[k] = p.key === undefined ? { ...p } : { ...p, key: mask(p.key) };
  }
  if (c.botKey !== undefined) out.botKey = mask(c.botKey);
  return out;
}

/**
 * undefined or a round-tripped masked value keeps the stored key; '' clears it.
 */
function pickKey(next: string | undefined, old: string | undefined): string | undefined {
  if (next === undefined || next.startsWith(MASK)) return old;
  return next === '' ? undefined : next;
}

export async function saveConfig(patch: ConfigPatch): Promise<Config> {
  const cur = await loadStored();
  const next: Config = { ...cur, providers: { ...cur.providers } };
  for (const k of KINDS) {
    const p = patch.providers?.[k];
    if (!p) continue;
    const old = cur.providers[k].key;
    const key = p.key === undefined ? old : pickKey(p.key, old);
    const { key: _drop, ...rest } = { ...cur.providers[k], ...p };
    next.providers[k] = key === undefined ? rest : { ...rest, key };
  }
  if ('botKey' in patch) next.botKey = pickKey(patch.botKey, cur.botKey);
  if (patch.botUrl !== undefined) next.botUrl = patch.botUrl;
  if (patch.port !== undefined) next.port = patch.port;
  if (next.botKey === undefined) delete next.botKey;
  await writeJson(file(), ConfigSchema, next, 0o600);
  return withEnvKeys(next);
}
