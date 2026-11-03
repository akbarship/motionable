// Lessons with a rule stop a batch that breaks them again, quoting the user; breaches the plan already had don't.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {applyBatch, LessonError, lessonsFor, type Lesson} from '../src';
import {deleteLesson, loadJob, loadLessons, saveLesson} from '../src/store';
import {makeHome} from './home';

const home = makeHome();
const job = loadJob(path.join(home, 'projects/sample-1'), home);
const lesson = (id: string, text: string, rule: Lesson['rule']): Lesson => ({id, scope: 'global', text, rule, at: '2026-11-01'});
const run = (lessons: Lesson[], ops: {op: string; [k: string]: unknown}[]) =>
  applyBatch(job.plan, {base: job.plan.version, by: {kind: 'mcp'}, ops}, {...job.ctx, lessons});

describe('lessons', () => {
  it('lets the references decide the look: a global lesson about the look applies to no style, a style\'s own does', () => {
    const all: Lesson[] = [
      {id: 'look', scope: 'global', about: 'style', text: 'soʻzlar sakrasin', at: '2026-11-01'},
      {id: 'craft', scope: 'global', about: 'craft', text: 'subtitr oʻqilsin', at: '2026-11-01'},
      {id: 'old', scope: 'global', text: 'kesishlar silliq', at: '2026-11-01'},
      {id: 'mine', scope: 'style:kofe', about: 'style', text: 'shu uslubda sariq yoʻq', at: '2026-11-01'},
      {id: 'other', scope: 'style:sohbat', text: 'boshqa uslub', at: '2026-11-01'},
    ];
    expect(lessonsFor(all, 'kofe@2').map((l) => l.id)).toEqual(['craft', 'old', 'mine']);
    expect(lessonsFor(all, 'sohbat').map((l) => l.id)).toEqual(['craft', 'old', 'other']);
  });

  it('saves only a known `about`', () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-about-'));
    expect(saveLesson({scope: 'global', about: 'craft', text: 'toza'}, state).about).toBe('craft');
    expect(() => saveLesson({scope: 'global', about: 'taste' as 'style', text: 'x'}, state)).toThrow(/about must be/);
  });

  it('rejects a batch that uses a forbidden component, in the user\'s words', () => {
    const l = lesson('no-hud', 'bu HUD menga yoqmadi', {kind: 'forbid', component: 'set-hud@1'});
    const o = job.plan.overlays.find((x) => x.component === 'set-hud@1')!;
    // the plan already uses it: other work goes on
    expect(() => run([l], [{op: 'note.add', text: 'x'}])).not.toThrow();
    // one more use is new: rejected, quoting the lesson
    const again = {...o, id: 'o_again'};
    try {
      run([l], [{op: 'overlay.add', overlay: again}]);
      throw new Error('not rejected');
    } catch (e) {
      expect(e).toBeInstanceOf(LessonError);
      expect((e as Error).message).toContain('[lesson:no-hud] "bu HUD menga yoqmadi"');
      expect((e as Error).message).toContain('overlay o_again');
    }
  });

  it('holds a role on screen for its minimum, counting only lines the batch breaks', () => {
    const l = lesson('hero-hold', 'katta soʻz tez yoʻqolmasin', {kind: 'min_hold', role: 'hero', s: 30});
    expect(() => run([l], [{op: 'note.add', text: 'x'}])).not.toThrow(); // existing hero lines: old breaches
    const cap = job.plan.captions.lines.find((x) => x.role === 'cap')!;
    expect(() => run([l], [{op: 'caption.setRole', line: cap.id, role: 'hero'}])).toThrow(/lesson:hero-hold.*min 30 s/s);
  });

  it('caps how often a thing appears and keeps text in front of the speaker', () => {
    const shots = lesson('few-cuts', 'kesish juda koʻp', {kind: 'max_per_minute', what: 'shot', n: 1});
    const s = job.plan.shots[0];
    expect(() => run([shots], [{op: 'shot.insert', after: s.id, shot: {...s, id: 'sx', from: `${s.from}+0.5`}}])).toThrow(/few-cuts/);
    const behind = lesson('front', 'matn odam orqasida boʻlmasin', {kind: 'no_behind_subject'});
    const o = job.plan.overlays.find((x) => x.depth !== 'behind-subject')!; // one that's in front today
    expect(() => run([behind], [{op: 'overlay.update', id: o.id, set: {depth: 'behind-subject'}}])).toThrow(/lesson:front/);
  });

  it('stores lessons as files with ids from their text', () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-lessons-'));
    const a = saveLesson({scope: 'style:sohbat', text: 'Subtitr juda mayda!', source: 'studio'}, state);
    const b = saveLesson({scope: 'global', text: 'Subtitr juda mayda!'}, state);
    expect([a.id, b.id]).toEqual(['subtitr-juda-mayda', 'subtitr-juda-mayda-2']);
    expect(loadLessons(state).map((x) => x.id)).toEqual([a.id, b.id]);
    expect(() => saveLesson({scope: 'nope', text: 'x'}, state)).toThrow('scope');
    deleteLesson(a.id, state);
    expect(loadLessons(state).length).toBe(1);
  });
});
