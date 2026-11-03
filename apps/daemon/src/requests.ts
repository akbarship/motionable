// The bridge between the Studio and the user's Claude in chat: the Studio queues a request, Claude long-polls for
// the next one (wait_for_studio), does it, and closes it with a one-line reply the Studio shows. The queue lives in
// <state>/requests.json, so a restart keeps it. Presence: is a Claude waiting right now, or working on a request.
import fs from 'node:fs';
import path from 'node:path';
import {STATE} from '@motionable/plan/store';

export type RequestKind = 'plan' | 'revise' | 'approve' | 'notes' | 'style';
export type StudioRequest = {
  id: string; kind: RequestKind; project?: string; style?: string; text?: string; at: string;
  status: 'queued' | 'taken' | 'done' | 'cancelled'; takenAt?: string; doneAt?: string; reply?: string;
};
export type Presence = {status: 'ready' | 'working' | 'offline'; request?: string; lastSeen?: string};

const KINDS: RequestKind[] = ['plan', 'revise', 'approve', 'notes', 'style'];
// what Claude does for each kind: one line, the skill has the rest
const TODO: Record<RequestKind, string> = {
  plan: 'read get_project_state (brief, files, cuts: true), then propose_plan; do not edit yet',
  revise: 'the user wants the proposal changed (text): propose_plan again',
  approve: 'the user approved the proposal: scaffold_plan with its style, then apply_ops scene by scene',
  notes: 'do the open notes in get_project_state; note.resolve each in the same batch',
  style: 'build this style from its references (references/style.md)',
};
const KEEP = 200; // closed requests kept for the Studio's history

export const createQueue = (file = path.join(STATE, 'requests.json'), onChange: (e: Record<string, unknown>) => void = () => {}) => {
  let list: StudioRequest[] = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  // a request taken by a Claude that went away (daemon restart) goes back to the queue
  for (const r of list) if (r.status === 'taken') r.status = 'queued';
  const save = () => {
    const open = list.filter((r) => r.status === 'queued' || r.status === 'taken');
    list = [...list.filter((r) => !open.includes(r)).slice(-KEEP), ...open].sort((a, b) => a.at.localeCompare(b.at));
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify(list));
  };
  const waiters = new Set<(r: StudioRequest | null) => void>();
  let lastSeen = 0;

  const presence = (): Presence => {
    const taken = list.find((r) => r.status === 'taken');
    if (taken) return {status: 'working', request: taken.id};
    // between two polls (Claude's turn after an idle wait) it still counts as here
    const here = waiters.size > 0 || Date.now() - lastSeen < 30000;
    return {status: here ? 'ready' : 'offline', ...(lastSeen ? {lastSeen: new Date(lastSeen).toISOString()} : {})};
  };
  let shown = '';
  const tell = (r?: StudioRequest) => {
    if (r) onChange({type: 'request', request: r});
    const p = presence();
    if (JSON.stringify(p) !== shown) {
      shown = JSON.stringify(p);
      onChange({type: 'claude', ...p});
    }
  };

  // a Claude that stopped polling goes offline with no event of its own: look again now and then
  setInterval(() => tell(), 10000).unref();

  const take = (r: StudioRequest) => {
    r.status = 'taken';
    r.takenAt = new Date().toISOString();
    save();
    tell(r);
    return r;
  };

  return {
    presence,
    list: (q: {project?: string; style?: string} = {}) =>
      list.filter((r) => (!q.project || r.project === q.project) && (!q.style || r.style === q.style)).slice(-20),

    add(req: {kind: string; project?: string; style?: string; text?: string}) {
      if (!KINDS.includes(req.kind as RequestKind)) throw new Error(`unknown request kind: ${req.kind}`);
      if (req.kind === 'style' ? !req.style : !req.project) throw new Error(req.kind === 'style' ? 'style is required' : 'project is required');
      // the same ask twice while the first is still waiting: one request
      const same = list.find((r) => r.status === 'queued' && r.kind === req.kind && r.project === req.project && r.style === req.style);
      if (same) {
        if (req.text) same.text = req.text;
        save();
        return same;
      }
      const r: StudioRequest = {id: `rq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind: req.kind as RequestKind,
        ...(req.project ? {project: req.project} : {}), ...(req.style ? {style: req.style} : {}), ...(req.text?.trim() ? {text: req.text.trim()} : {}),
        at: new Date().toISOString(), status: 'queued'};
      list.push(r);
      save();
      const w = waiters.values().next().value;
      if (w) {
        waiters.delete(w);
        w(take(r));
      } else tell(r);
      return r;
    },

    cancel(id: string) {
      const r = list.find((x) => x.id === id);
      if (!r) throw new Error(`no request ${id}`);
      if (r.status !== 'queued') throw new Error('Claude has already taken this request');
      r.status = 'cancelled';
      save();
      tell(r);
      return r;
    },

    done(id: string, reply?: string) {
      const r = list.find((x) => x.id === id);
      if (!r) throw new Error(`no request ${id}`);
      if (r.status === 'done') return r;
      r.status = 'done';
      r.doneAt = new Date().toISOString();
      if (reply?.trim()) r.reply = reply.trim().slice(0, 1000);
      save();
      tell(r);
      return r;
    },

    /** The next queued request (taken now), or null after waitMs. */
    next(waitMs: number, signal?: AbortSignal): Promise<StudioRequest | null> {
      lastSeen = Date.now();
      const q = list.find((r) => r.status === 'queued');
      if (q) return Promise.resolve(take(q));
      return new Promise((resolve) => {
        const finish = (r: StudioRequest | null) => {
          clearTimeout(timer);
          waiters.delete(finish);
          lastSeen = Date.now();
          resolve(r);
          tell();
        };
        const timer = setTimeout(() => finish(null), waitMs);
        signal?.addEventListener('abort', () => finish(null));
        waiters.add(finish);
        tell();
      });
    },
  };
};
export type Queue = ReturnType<typeof createQueue>;

/** A request as Claude gets it: compact, with the one line of what to do. */
export const forClaude = (r: StudioRequest) => ({id: r.id, kind: r.kind, ...(r.project ? {project: r.project} : {}),
  ...(r.style ? {style: r.style} : {}), ...(r.text ? {text: r.text} : {}), todo: TODO[r.kind]});
