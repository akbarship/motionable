import type { Kind, Words } from '../core/types.js';

export type GenReq = {
  kind: Kind;
  params: Record<string, unknown>;
  outDir: string;
  /** Used as the downloaded file's base name. */
  taskId?: string;
};

export interface GenerationProvider {
  kinds: Kind[];
  quote(r: GenReq): Promise<{ usd: number }>;
  run(r: GenReq): Promise<{ file: string; usd: number }>;
  /** Speech to text for a local media file. Present when the provider serves 'stt'. */
  transcribe?(file: string): Promise<Words>;
}

export type PollOpts = { pollMs?: number; timeoutMs?: number };
