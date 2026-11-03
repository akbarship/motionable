// The guard: only this computer's names as Host, only its own pages as Origin, nothing cross-site.
import {describe, expect, it} from 'vitest';
import Fastify from 'fastify';
import {allowedHost, allowedOrigin, guard} from '../src/guard';

describe('guard', () => {
  it('accepts only local hosts and origins', () => {
    for (const h of ['127.0.0.1:4377', 'localhost:5173', '[::1]:4377', 'localhost']) expect(allowedHost(h)).toBe(true);
    for (const h of ['evil.com', '127.0.0.1.evil.com', 'localhost.evil.com:4377', '', undefined]) expect(allowedHost(h)).toBe(false);
    for (const o of [undefined, 'http://localhost:5173', 'http://127.0.0.1:4377']) expect(allowedOrigin(o)).toBe(true);
    for (const o of ['https://evil.com', 'null', 'http://127.0.0.1.evil.com', 'file://']) expect(allowedOrigin(o)).toBe(false);
  });

  it('refuses foreign requests before any route', async () => {
    const app = Fastify();
    guard(app);
    app.get('/api/health', () => ({ok: true}));
    app.post('/api/settings', () => ({ok: true}));
    const go = (method: 'GET' | 'POST', headers: Record<string, string>) =>
      app.inject({method, url: method === 'GET' ? '/api/health' : '/api/settings', headers}).then((r) => r.statusCode);
    expect(await go('GET', {host: '127.0.0.1:4377'})).toBe(200);
    expect(await go('GET', {host: 'evil.com'})).toBe(403);
    expect(await go('POST', {host: '127.0.0.1:4377', origin: 'http://localhost:5173'})).toBe(200);
    expect(await go('POST', {host: '127.0.0.1:4377', origin: 'https://evil.com'})).toBe(403);
    expect(await go('POST', {host: '127.0.0.1:4377', 'sec-fetch-site': 'cross-site'})).toBe(403);
  });
});
