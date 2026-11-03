// propose_plan: checked against the source, every version kept, and the user's answer recorded on it.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {currentProposal, decide, proposals, saveProposal} from '../src/proposal';

const project = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-prop-'));
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({id: 'p', brief: {about: 'x', mode: 'edit', style: 'kofe@1'},
    assets: {src_main: {path: 'input/source.mp4', kind: 'video', meta: {duration: 30}}}}));
  return dir;
};
const scene = (from: number, to: number) => ({from, to, title: 'Hook', what: 'katta sarlavha', why: 'birinchi 2 s ushlaydi'});

describe('proposal', () => {
  it('checks scenes and cuts', () => {
    const dir = project();
    expect(() => saveProposal(dir, {summary: '', scenes: [scene(0, 5)]})).toThrow(/summary/);
    expect(() => saveProposal(dir, {summary: 's', scenes: []})).toThrow(/scene/);
    expect(() => saveProposal(dir, {summary: 's', scenes: [scene(5, 2)]})).toThrow(/before/);
    expect(() => saveProposal(dir, {summary: 's', scenes: [scene(0, 10), scene(8, 12)]})).toThrow(/before scene 1 ends/);
    expect(() => saveProposal(dir, {summary: 's', scenes: [scene(0, 29)], cuts: [{from: 1, to: 3, why: 'retake'}]})).toThrow(/past the 28s/);
    expect(() => saveProposal(dir, {summary: 's', scenes: [scene(0, 5)], cuts: [{from: 1, to: 3, why: ''}]})).toThrow(/why/);
    expect(proposals(dir)).toEqual([]);
  });

  it('keeps versions and the answer', () => {
    const dir = project();
    const a = saveProposal(dir, {summary: 'Kofe reels', scenes: [scene(0, 10), scene(10, 27.5)], cuts: [{from: 20, to: 22.5, why: 'retake'}], audio: 'past musiqa'});
    expect(a).toMatchObject({v: 1, durationS: 27.5, cutS: 2.5, status: 'proposed', style: 'kofe@1'});
    decide(dir, 'revise', 'hook qisqaroq');
    const b = saveProposal(dir, {summary: 'Kofe reels, qisqa hook', scenes: [scene(0, 3), scene(3, 30)]});
    expect(b.v).toBe(2);
    expect(proposals(dir)[0]).toMatchObject({status: 'revise', feedback: 'hook qisqaroq'});
    decide(dir, 'approved');
    expect(currentProposal(dir)?.status).toBe('approved');
  });
});
