import type { Kind, Words } from '../core/types.js';

export type GenReq = {
  kind: Kind;
  params: Record<string, unknown>;
  outDir: string;
  /** Project directory; project-relative params.refFrames resolve against it. */
  projectDir?: string;
  /** Used as the downloaded file's base name. */
  taskId?: string;
  /** Called right before the request that creates a billable job. After it, a failure may still have billed. */
  onCreateAttempt?: () => void | Promise<void>;
  /** Called as soon as the provider created a billable job, so a retry can resume it. */
  onJobId?: (jobId: string) => void | Promise<void>;
  /** Poll this existing job instead of creating a new one. */
  resumeJobId?: string;
};

export interface GenerationProvider {
  kinds: Kind[];
  quote(r: GenReq): Promise<{ usd: number }>;
  run(r: GenReq): Promise<{ file: string; usd: number }>;
  /** Speech to text for a local media file. Present when the provider serves 'stt'. */
  transcribe?(file: string): Promise<Words>;
}

export type PollOpts = { pollMs?: number; timeoutMs?: number };
