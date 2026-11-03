// Notes: the user's timed notes on the edit, closed by Claude with a reply; old plain-string notes still read.
import {describe, expect, it} from 'vitest';
import path from 'node:path';
import {applyBatch, notesOf} from '../src';
import {loadJob} from '../src/store';
import {makeHome} from './home';

const home = makeHome();
const job = loadJob(path.join(home, 'projects/sample-1'), home);
const run = (plan: typeof job.plan, ops: {op: string; [k: string]: unknown}[]) =>
  applyBatch(plan, {base: plan.version, by: {kind: 'editor'}, ops}, job.ctx).plan;

describe('notes', () => {
  it('reads old string notes as done ones with ids by position', () => {
    const old = notesOf(job.plan);
    expect(old.length).toBeGreaterThan(0);
    expect(old[0]).toMatchObject({id: 'n1', status: 'done'});
  });

  it('adds a timed note, resolves it with a reply and reopens it', () => {
    const n0 = notesOf(job.plan).length;
    let p = run(job.plan, [{op: 'note.add', text: 'shu yerda zoom kerak', at: 'word:12', to: 'word:14.end'}]);
    const added = notesOf(p).at(-1)!;
    expect(added).toMatchObject({id: `n${n0 + 1}`, status: 'open', at: 'word:12', to: 'word:14.end', by: 'editor', text: 'shu yerda zoom kerak'});
    p = run(p, [{op: 'note.resolve', id: added.id, reply: 'punch-in qoʻyildi'}]);
    expect(notesOf(p).at(-1)).toMatchObject({status: 'done', reply: 'punch-in qoʻyildi'});
    p = run(p, [{op: 'note.reopen', id: added.id}]);
    expect(notesOf(p).at(-1)!.status).toBe('open');
    expect(() => run(p, [{op: 'note.add', text: 'x', at: 'nonsense'}])).toThrow();
    expect(() => run(p, [{op: 'note.resolve', id: 'n999'}])).toThrow('no note');
  });
});
