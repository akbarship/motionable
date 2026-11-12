import { downloadResult } from './download.js';
import type { GenReq, GenerationProvider, PollOpts } from './types.js';
import { httpError, num, poll, prices, strParam, usd } from './util.js';

// Verification status (2026-11-12):
//  - LIVE: POST /api/v1/jobs/createTask with {model:'nano-banana-2', input:{prompt, aspect_ratio:'9:16'}} succeeded
//    (8 credits); GET /api/v1/jobs/recordInfo?taskId= gives data.state waiting|queuing|generating|success|fail,
//    data.resultJson = JSON string {"resultUrls":[...]}, data.failMsg/failCode on failure. HTTP 200 may carry body.code != 200.
//  - DOCS: Veo 3.1 https://docs.kie.ai/veo3-api/generate-veo-3-video and task detail
//    https://docs.kie.ai/market/common/get-task-detail. Veo: model 'veo-3-1', input {prompt, generation_type, model
//    veo3_fast|veo3_lite|veo3, aspect_ratio 9:16|16:9|Auto, duration 4|6|8, resolution 720p|1080p|4k}. For 1080p/4k the
//    URL may sit in resultJson.data.result_urls (720p: data.origin_urls), so several result shapes are parsed.
//  - DOCS/product pages: Kling 4.0 https://kie.ai/kling-4-0 ('kling-4.0/reference-to-video', works without references);
//    Nano Banana Pro https://kie.ai/nano-banana-pro (image_input, resolution 1K|2K|4K, output_format).
//    Kling field names come from the product playground and are not yet confirmed by a live run.
const API = 'https://api.kie.ai';
const CREATE = `${API}/api/v1/jobs/createTask`;
const RECORD = `${API}/api/v1/jobs/recordInfo`;
const IMAGE_MODELS: Record<string, string> = { 'nano-banana-2': 'nano-banana-2', 'nano-banana-pro': 'nano-banana-pro' };
const VIDEO_MODELS: Record<string, { model: string; tier?: string; seconds: number }> = {
  veo3_fast: { model: 'veo-3-1', tier: 'veo3_fast', seconds: 8 },
  veo3_lite: { model: 'veo-3-1', tier: 'veo3_lite', seconds: 8 },
  veo3: { model: 'veo-3-1', tier: 'veo3', seconds: 8 },
  kling: { model: 'kling-4.0/reference-to-video', seconds: 5 },
};
const VIDEO_TIMEOUT_MS = 20 * 60_000;

/** Veo only takes 4, 6 or 8 s. Nearest wins; a tie (5, 7) rounds up so the clip is never shorter than asked. */
export function snapVeoSeconds(v: unknown): number {
  const s = num(v, 8);
  return [4, 6, 8].reduce((best, c) => (Math.abs(c - s) < Math.abs(best - s) || (Math.abs(c - s) === Math.abs(best - s) && c > best) ? c : best));
}
const klingSeconds = (v: unknown): number => Math.min(30, Math.max(3, Math.round(num(v, 5))));
const seconds = (m: string, v: unknown): number => (m === 'kling' ? klingSeconds(v) : m.startsWith('veo') ? snapVeoSeconds(v) : num(v, 8));

function resultUrl(rec: Record_): string | undefined {
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(rec.resultJson ?? '{}') as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const inner = j.data && typeof j.data === 'object' ? (j.data as Record<string, unknown>) : {};
  for (const c of [j.resultUrls, inner.result_urls, inner.origin_urls, j.result_urls, j.origin_urls]) {
    if (Array.isArray(c) && typeof c[0] === 'string') return c[0];
  }
  return undefined;
}

type Envelope<T> = { code?: number; msg?: string; data?: T };
type Record_ = { state?: string; resultJson?: string | null; failMsg?: string | null };

/** Own-key adapter for kie.ai: image (Nano Banana) and video (Veo 3.1 Fast, Kling). Failed tasks cost 0. */
export function createKie(key: string, o: PollOpts = {}): GenerationProvider {
  async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' } });
    if (!res.ok) throw httpError('kie.ai', res.status);
    const j = (await res.json()) as Envelope<T>;
    if (j.code !== undefined && j.code !== 200) throw new Error(`kie.ai error ${j.code}: ${j.msg ?? ''}`.trim());
    return j.data as T;
  }

  function modelOf(r: GenReq): string {
    if (r.kind === 'image') {
      const m = strParam(r.params.model, 'nano-banana-2');
      if (!IMAGE_MODELS[m]) throw new Error(`unknown kie image model: ${m}`);
      return m;
    }
    const m = strParam(r.params.model, 'veo3_fast');
    if (!VIDEO_MODELS[m]) throw new Error(`unknown kie video model: ${m}`);
    return m;
  }

  function body(r: GenReq): Record<string, unknown> {
    const p = r.params;
    const prompt = strParam(p.prompt, '');
    if (!prompt) throw new Error('prompt is required');
    const imageUrls = Array.isArray(p.imageUrls) ? p.imageUrls : undefined;
    const aspect = typeof p.aspectRatio === 'string' ? p.aspectRatio : undefined;
    if (r.kind === 'image') {
      const m = modelOf(r);
      const input: Record<string, unknown> = { prompt, aspect_ratio: aspect ?? '9:16' };
      if (m === 'nano-banana-pro') {
        if (imageUrls) input.image_input = imageUrls;
        input.resolution = strParam(p.resolution, '1K');
      } else if (imageUrls) input.image_urls = imageUrls;
      return { model: IMAGE_MODELS[m], input };
    }
    const m = modelOf(r);
    const v = VIDEO_MODELS[m];
    if (m === 'kling') {
      // verify on first live run
      return {
        model: v.model,
        input: { prompt, duration: klingSeconds(p.seconds), resolution: strParam(p.resolution, '720P'), aspect_ratio: aspect ?? '9:16' },
      };
    }
    return {
      model: v.model,
      input: {
        prompt,
        ...(imageUrls ? { image_urls: imageUrls } : { generation_type: 'TEXT_2_VIDEO' }),
        model: v.tier,
        aspect_ratio: aspect ?? '9:16',
        duration: snapVeoSeconds(p.seconds),
        resolution: strParam(p.resolution, '720p'),
      },
    };
  }

  return {
    kinds: ['image', 'video'],
    async quote(r) {
      const m = modelOf(r);
      if (r.kind === 'image') return { usd: usd(prices.image[m as keyof typeof prices.image]) };
      const rate = prices.video[m as keyof typeof prices.video].perSecond;
      return { usd: usd(rate * seconds(m, r.params.seconds)) };
    },
    async run(r) {
      const q = await this.quote(r);
      let taskId = r.resumeJobId;
      if (!taskId) {
        const payload = JSON.stringify(body(r));
        await r.onCreateAttempt?.();
        const created = await api<{ taskId?: string }>(CREATE, { method: 'POST', body: payload });
        if (!created?.taskId) throw new Error('kie.ai answered without a task id');
        taskId = created.taskId;
        await r.onJobId?.(taskId);
      }
      const job = taskId;
      const rec = await poll(async () => {
        const d = await api<Record_>(`${RECORD}?taskId=${encodeURIComponent(job)}`);
        if (d.state === 'fail') throw new Error(`kie.ai task failed: ${d.failMsg || 'unknown error'}`);
        return d.state === 'success' ? d : undefined;
      }, { ...o, timeoutMs: o.timeoutMs ?? (r.kind === 'video' ? VIDEO_TIMEOUT_MS : undefined) });
      const first = resultUrl(rec);
      if (!first) throw new Error('kie.ai task finished without a result url');
      return { file: await downloadResult(first, r.outDir, r.taskId), usd: q.usd };
    },
  };
}
