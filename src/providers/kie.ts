import { downloadResult } from './download.js';
import type { GenReq, GenerationProvider, PollOpts } from './types.js';
import { httpError, num, poll, prices, strParam, usd } from './util.js';

// Docs used (fetched 2026-11-12):
//  - https://docs.kie.ai/market/common/get-task-detail  GET /api/v1/jobs/recordInfo?taskId=, data.state
//    waiting|queuing|generating|success|fail, data.resultJson = JSON string {"resultUrls":[...]}  (VERIFIED)
//  - https://docs.kie.ai/veo3-api/generate-veo-3-video  body {model:'veo-3-1', input:{prompt, model:'veo3_fast',
//    aspect_ratio, duration, image_urls}}, data.taskId; HTTP 200 even on error, check body.code  (VERIFIED body;
//    the page did not print its path, so the shared createTask path is UNVERIFIED for Veo)
//  - Nano Banana 2 model id 'nano-banana-2', POST /api/v1/jobs/createTask (from search snippet of
//    https://docs.kie.ai/market/google/nano-banana-2; that page returned 404 on direct fetch)
// UNVERIFIED: 'nano-banana-pro' and 'kling-3.0/video' model ids and the Kling/Nano input field names.
const API = 'https://api.kie.ai';
const CREATE = `${API}/api/v1/jobs/createTask`;
const RECORD = `${API}/api/v1/jobs/recordInfo`;
const IMAGE_MODELS: Record<string, string> = { 'nano-banana-2': 'nano-banana-2', 'nano-banana-pro': 'nano-banana-pro' };
const VIDEO_MODELS: Record<string, { model: string; tier?: string; seconds: number }> = {
  veo3_fast: { model: 'veo-3-1', tier: 'veo3_fast', seconds: 8 },
  kling: { model: 'kling-3.0/video', seconds: 5 },
};

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
    const extra = {
      ...(typeof p.aspectRatio === 'string' ? { aspect_ratio: p.aspectRatio } : {}),
      ...(Array.isArray(p.imageUrls) ? { image_urls: p.imageUrls } : {}),
    };
    if (r.kind === 'image') return { model: IMAGE_MODELS[modelOf(r)], input: { prompt, ...extra } };
    const v = VIDEO_MODELS[modelOf(r)];
    const duration = num(p.seconds, v.seconds);
    return { model: v.model, input: { prompt, duration, ...(v.tier ? { model: v.tier } : {}), ...extra } };
  }

  return {
    kinds: ['image', 'video'],
    async quote(r) {
      const m = modelOf(r);
      if (r.kind === 'image') return { usd: usd(prices.image[m as keyof typeof prices.image]) };
      const rate = prices.video[m as keyof typeof prices.video].perSecond;
      return { usd: usd(rate * num(r.params.seconds, VIDEO_MODELS[m].seconds)) };
    },
    async run(r) {
      const q = await this.quote(r);
      let taskId = r.resumeJobId;
      if (!taskId) {
        taskId = (await api<{ taskId: string }>(CREATE, { method: 'POST', body: JSON.stringify(body(r)) })).taskId;
        await r.onJobId?.(taskId);
      }
      const job = taskId;
      const rec = await poll(async () => {
        const d = await api<Record_>(`${RECORD}?taskId=${encodeURIComponent(job)}`);
        if (d.state === 'fail') throw new Error(`kie.ai task failed: ${d.failMsg || 'unknown error'}`);
        return d.state === 'success' ? d : undefined;
      }, o);
      let urls: unknown;
      try {
        urls = (JSON.parse(rec.resultJson ?? '{}') as { resultUrls?: unknown }).resultUrls;
      } catch {
        urls = undefined;
      }
      const first = Array.isArray(urls) ? urls[0] : undefined;
      if (typeof first !== 'string') throw new Error('kie.ai task finished without a result url');
      return { file: await downloadResult(first, r.outDir, r.taskId), usd: q.usd };
    },
  };
}
