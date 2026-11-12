import { WordsSchema, type Words } from '../core/types.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { downloadResult } from './download.js';
import type { GenReq, GenerationProvider, PollOpts } from './types.js';
import { httpError, poll } from './util.js';

// PLACEHOLDER: the real backend does not exist yet (spec section 8, part B). Override with config.botUrl.
export const DEFAULT_BOT_URL = 'https://bot.invalid';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Normalised bot base URL, or null when it is not https (plain http is allowed for localhost only). */
export function checkBotUrl(raw: string | undefined): string | null {
  let u: URL;
  try {
    u = new URL(raw ?? DEFAULT_BOT_URL);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return null;
  return u.href.replace(/\/+$/, '');
}

type BotCfg = { botKey: string; botUrl?: string };
type Job = { status: string; url?: string; usd?: number; error?: string };

export type BotProvider = GenerationProvider & { balance(): Promise<{ usd: number }> };

/** Adapter for the Motionable bot backend: one Bearer key serves all four kinds. */
export function createBotProvider(c: BotCfg, o: PollOpts & { allowInsecure?: boolean } = {}): BotProvider {
  const base = checkBotUrl(c.botUrl);
  if (!base) throw new Error('bad_bot_url');

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idemKey?: string): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${c.botKey}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 402) throw new Error('insufficient_balance');
    if (!res.ok) throw httpError('bot', res.status);
    return (await res.json()) as T;
  }

  const payload = (r: GenReq) => {
    const { model, ...params } = r.params;
    return { kind: r.kind, ...(typeof model === 'string' ? { model } : {}), params };
  };

  async function finished(r: GenReq): Promise<Job & { status: 'done' }> {
    let jobId = r.resumeJobId;
    if (!jobId) {
      jobId = (await call<{ jobId: string }>('POST', '/v1/run', payload(r), r.taskId)).jobId;
      await r.onJobId?.(jobId);
    }
    const id = jobId;
    return poll(async () => {
      const j = await call<Job>('GET', `/v1/jobs/${encodeURIComponent(id)}`);
      if (j.status === 'failed') throw new Error(`bot job failed: ${j.error ?? 'unknown error'}`);
      return j.status === 'done' ? (j as Job & { status: 'done' }) : undefined;
    }, o);
  }

  return {
    kinds: ['image', 'video', 'tts', 'stt'],
    balance: () => call<{ usd: number }>('GET', '/v1/balance'),
    quote: async (r) => ({ usd: (await call<{ usd: number }>('POST', '/v1/quote', payload(r))).usd }),
    async run(r) {
      const j = await finished(r);
      if (!j.url) throw new Error('bot job finished without a result url');
      const file = await downloadResult(j.url, r.outDir, r.taskId, { allowInsecure: o.allowInsecure });
      return { file, usd: j.usd ?? 0 };
    },
    async transcribe(file): Promise<Words> {
      // ASSUMPTION: the bot accepts base64 audio in params and returns a url to a words JSON.
      const audio = (await readFile(file)).toString('base64');
      const j = await finished({ kind: 'stt', outDir: '', params: { filename: basename(file), audioBase64: audio } });
      if (!j.url) throw new Error('bot job finished without a result url');
      if (!o.allowInsecure && !j.url.startsWith('https://')) throw new Error('download refused: https only');
      const res = await fetch(j.url, { redirect: 'error' });
      if (!res.ok) throw httpError('bot', res.status);
      return WordsSchema.parse(await res.json());
    },
  };
}
