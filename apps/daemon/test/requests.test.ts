// The Studio ↔ Claude bridge: a request waits for a Claude, a waiting Claude gets the next request at once,
// done closes it with a reply, presence follows, and the queue survives a restart.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQueue, forClaude} from '../src/requests';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rq-')), 'requests.json');

describe('requests', () => {
  it('request → wait → done', async () => {
    const events: Record<string, unknown>[] = [];
    const q = createQueue(tmp(), (e) => events.push(e));
    expect(q.presence().status).toBe('offline');
    const r = q.add({kind: 'notes', project: 'p1'});
    expect(q.add({kind: 'notes', project: 'p1'}).id).toBe(r.id); // asked twice while waiting: one request
    const got = await q.next(1000);
    expect(got?.id).toBe(r.id);
    expect(q.presence()).toMatchObject({status: 'working', request: r.id});
    expect(forClaude(got!)).toMatchObject({id: r.id, kind: 'notes', project: 'p1', todo: expect.stringContaining('note.resolve')});
    q.done(r.id, 'Ikkala izohni tuzatdim.');
    expect(q.list({project: 'p1'}).at(-1)).toMatchObject({status: 'done', reply: 'Ikkala izohni tuzatdim.'});
    expect(events.some((e) => e.type === 'claude' && e.status === 'working')).toBe(true);
  });

  it('a waiting Claude gets a new request at once, or idle after the wait', async () => {
    const q = createQueue(tmp());
    expect(await q.next(20)).toBeNull();
    const waiting = q.next(5000);
    expect(q.presence().status).toBe('ready');
    const r = q.add({kind: 'style', style: 'calm'});
    expect((await waiting)?.id).toBe(r.id);
    expect(() => q.add({kind: 'plan'})).toThrow(/project/);
    expect(() => q.add({kind: 'nope', project: 'p'})).toThrow(/kind/);
  });

  it('keeps the queue over a restart; a taken request goes back to the queue', async () => {
    const file = tmp();
    const a = createQueue(file);
    const r = a.add({kind: 'plan', project: 'p2', text: 'qisqaroq'});
    const c = a.add({kind: 'notes', project: 'p3'});
    await a.next(10);
    a.cancel(c.id);
    const b = createQueue(file);
    expect((await b.next(10))?.id).toBe(r.id);
    expect(await b.next(10)).toBeNull(); // the cancelled one never comes
  });
});
