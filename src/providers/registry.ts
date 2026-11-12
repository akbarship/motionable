import type { Config, Kind } from '../core/types.js';
import { checkBotUrl, createBotProvider } from './bot.js';
import { createElevenLabs } from './elevenlabs.js';
import { createKie } from './kie.js';
import type { GenerationProvider, PollOpts } from './types.js';

/** Provider for a kind, or null when it is off, misconfigured or has no key. */
export function providerFor(kind: Kind, cfg: Config, poll: PollOpts = {}): GenerationProvider | null {
  const p = cfg.providers[kind];
  switch (p.use) {
    case 'off':
      return null;
    case 'kie':
      return (kind === 'image' || kind === 'video') && p.key ? createKie(p.key, poll) : null;
    case 'elevenlabs':
      if ((kind !== 'tts' && kind !== 'stt') || !p.key) return null;
      return createElevenLabs(kind === 'tts' ? { tts: p.key } : { stt: p.key });
    case 'bot':
      return cfg.botKey && checkBotUrl(cfg.botUrl) ? createBotProvider({ botKey: cfg.botKey, botUrl: cfg.botUrl }, poll) : null;
  }
}

export type QuoteItem = { kind: Kind; params: Record<string, unknown> };

/** Sum quotes for plan review. Kinds with no provider are listed in `missing` instead of failing. */
export async function quoteItems(
  items: QuoteItem[],
  cfg: Config,
  outDir: string,
  providerOf: typeof providerFor = providerFor,
): Promise<{ usd: number; missing: Kind[] }> {
  let total = 0;
  const missing = new Set<Kind>();
  for (const it of items) {
    const p = providerOf(it.kind, cfg);
    if (!p) {
      missing.add(it.kind);
      continue;
    }
    total += (await p.quote({ kind: it.kind, params: it.params, outDir })).usd;
  }
  return { usd: Math.round(total * 10_000) / 10_000, missing: [...missing] };
}
