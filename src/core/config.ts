import { join } from 'node:path';
import { home } from './paths.js';
import { readJson, writeJson } from './store.js';
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

export async function loadConfig(): Promise<Config> {
  try {
    return await readJson(file(), ConfigSchema);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw e;
  }
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
  const cur = await loadConfig();
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
  return next;
}
