// Undo: every version is kept, an undo restores the one before the last change as a new version.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {commitBatch, loadJob, undo, undoTarget} from '../src/store';
import {makeHome} from './home';

describe('undo', () => {
  it('takes back changes one by one and never undoes an undo', () => {
    const home = makeHome();
    const dir = path.join(home, 'projects/sample-1');
    fs.rmSync(path.join(dir, 'plan', 'history.jsonl'), {force: true});
    const job = loadJob(dir, home);
    const v0 = job.plan.version;
    const note = (text: string) => commitBatch(job, {base: job.plan.version, by: {kind: 'editor'}, ops: [{op: 'note.add', text}]});
    note('a');
    note('b');
    note('c');
    const texts = () => job.plan.notes.map((n) => (typeof n === 'string' ? n : n.text));
    expect(texts().slice(-3)).toEqual(['a', 'b', 'c']);

    const r1 = undo(job);
    expect(r1.restored).toBe(v0 + 2);
    expect(job.plan.version).toBe(v0 + 4);
    expect(texts().slice(-2)).toEqual(['a', 'b']);

    const r2 = undo(job);
    expect(r2.restored).toBe(v0 + 1);
    expect(texts().at(-1)).toBe('a');
    expect(undoTarget(dir)).toBeNull(); // the first change in this history stays
    expect(() => undo(job)).toThrow('nothing to undo');
    expect(fs.existsSync(path.join(dir, 'plan', 'versions', `v${v0}.json`))).toBe(true);
  });
});
