import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockBot = {
  url: string;
  calls: { method: string; path: string; auth: string | undefined; body: unknown; idem?: string }[];
  close: () => Promise<void>;
};

export type MockOpts = { balance?: number; usd?: number; failWith?: number; pollsBeforeDone?: number; jobError?: string };

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : undefined;
}

/** Local implementation of the bot HTTP contract (spec section 8). Bearer `testkey` is required. */
export async function startMockBot(o: MockOpts = {}): Promise<MockBot> {
  const calls: MockBot['calls'] = [];
  let polls = 0;
  const server: Server = createServer(async (req, res) => {
    const path = req.url ?? '/';
    const b = await body(req);
    calls.push({ method: req.method ?? 'GET', path, auth: req.headers.authorization, body: b, idem: req.headers['idempotency-key'] as string | undefined });
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (path === '/files/out.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      return res.end(Buffer.from('FAKEVIDEO'));
    }
    if (req.headers.authorization !== 'Bearer testkey') return json(401, { error: 'unauthorized' });
    if (o.failWith && path !== '/v1/balance') return json(o.failWith, { error: 'nope' });
    if (path === '/v1/balance') return json(200, { usd: o.balance ?? 12.5 });
    if (path === '/v1/quote') return json(200, { usd: o.usd ?? 0.4 });
    if (path === '/v1/run') return json(200, { jobId: 'job1' });
    if (path === '/v1/jobs/job1') {
      polls += 1;
      if (o.jobError) return json(200, { status: 'failed', error: o.jobError });
      if (polls <= (o.pollsBeforeDone ?? 1)) return json(200, { status: 'running' });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return json(200, { status: 'done', url: `${base}/files/out.mp4`, usd: o.usd ?? 0.4 });
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}
