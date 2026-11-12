import prices from './prices.json' with { type: 'json' };
import type { PollOpts } from './types.js';

export const DEFAULT_POLL_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export { prices };

/** Error for a non-2xx answer. Never includes the request, headers or keys. */
export function httpError(who: string, status: number): Error {
  return new Error(`${who} request failed with status ${status}`);
}

/** Calls `step` until it returns a value (not undefined), sleeping pollMs between tries. */
export async function poll<T>(step: () => Promise<T | undefined>, o: PollOpts = {}): Promise<T> {
  const pollMs = o.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  for (;;) {
    const v = await step();
    if (v !== undefined) return v;
    if (Date.now() >= deadline) throw new Error('generation timed out');
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : dflt);
export const strParam = (v: unknown, dflt: string): string => (typeof v === 'string' && v ? v : dflt);

/** Round to 4 decimals so quotes are stable. */
export const usd = (n: number): number => Math.round(n * 10_000) / 10_000;
