// "Send to Claude" from the Studio: the user's own Claude Code runs headless (claude -p, their login, no API key)
// with only the Motionable tools, works through the open notes and closes each with a reply. One run at a time.
import {spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectDir} from './projects';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONFIG = path.join(os.homedir(), '.motionable', 'claude-mcp.json');

/** The prompt for the notes: the same text the Studio copies for a session the user already has open. */
export const notesPrompt = (id: string) =>
  `Motionable loyihasi "${id}": Studio'dagi ochiq izohlarni bajar. get_project_state {project: "${id}"} → notes (har birida t = videodagi soniya). ` +
  `Har bir izoh uchun: kerak bo'lsa look {project, plan: true, from, to} bilan qara, apply_ops bilan tuzat (base = oxirgi versiya, qisqa why), ` +
  `keyin shu batch ichida note.resolve {id, reply} bilan bir jumlada nima qilganingni yoz. Tushunarsiz izohga tegma: note.resolve qilmasdan, ` +
  `reply'siz qoldir va oxirida savolingni yoz. Render qilma.`;

const SYSTEM = 'This run was started by the user from the Motionable Studio ("Send to Claude"): they have approved acting on their notes. ' +
  'Work only through the motionable tools; never edit files or run commands. Answer in Uzbek (Latin), briefly.';

export type ClaudeRun = {status: 'running' | 'done' | 'failed' | 'stopped'; startedAt: string; steps: string[]; result?: string; costUsd?: number};

const runs = new Map<string, {proc: ChildProcess; run: ClaudeRun}>();
const last = new Map<string, ClaudeRun>();

/** The exact command, for the Studio to show before anything runs. */
export const claudeCommand = (id: string) => {
  const args = ['-p', notesPrompt(id), '--output-format', 'stream-json', '--verbose', '--mcp-config', CONFIG, '--strict-mcp-config',
    '--allowedTools', 'mcp__motionable', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', '--append-system-prompt', SYSTEM];
  return {bin: 'claude', args, cwd: projectDir(id)};
};

export const claudeStatus = (id: string) => runs.get(id)?.run ?? last.get(id) ?? null;

export const startClaude = (id: string, emit: (e: Record<string, unknown>) => void) => {
  if (runs.has(id)) throw new Error('Claude is already working on this project');
  fs.mkdirSync(path.dirname(CONFIG), {recursive: true});
  fs.writeFileSync(CONFIG, JSON.stringify({mcpServers: {motionable: {command: path.join(REPO, 'node_modules/.bin/tsx'),
    args: [path.join(REPO, 'apps/mcp/src/main.ts')]}}}, null, 2));
  const {bin, args, cwd} = claudeCommand(id);
  const logFile = path.join(cwd, 'claude', `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  fs.mkdirSync(path.dirname(logFile), {recursive: true});
  const log = fs.createWriteStream(logFile);
  const proc = spawn(bin, args, {cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
  const run: ClaudeRun = {status: 'running', startedAt: new Date().toISOString(), steps: []};
  runs.set(id, {proc, run});
  const step = (s: string) => {
    run.steps = [...run.steps, s].slice(-30);
    emit({type: 'claude', project: id, status: run.status, step: s});
  };
  emit({type: 'claude', project: id, status: 'running'});

  // stream-json: one event per line; we show tool calls and short texts, and keep the whole log on disk
  let buf = '';
  proc.stdout!.on('data', (d: Buffer) => {
    log.write(d);
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'assistant') {
          for (const c of ev.message?.content ?? []) {
            if (c.type === 'tool_use') step(`→ ${String(c.name).replace('mcp__motionable__', '')}`);
            if (c.type === 'text' && c.text?.trim()) step(c.text.trim().slice(0, 200));
          }
        }
        if (ev.type === 'result') {
          run.result = String(ev.result ?? '').slice(0, 2000);
          run.costUsd = ev.total_cost_usd;
          if (ev.is_error) run.status = 'failed';
        }
      } catch {}
    }
  });
  let err = '';
  proc.stderr!.on('data', (d: Buffer) => (err = (err + d).slice(-1000)));
  proc.on('error', (e) => {
    run.status = 'failed';
    run.result = `claude could not start: ${e.message}`;
  });
  proc.on('close', (code) => {
    log.end();
    if (run.status === 'running') run.status = code === 0 ? 'done' : 'failed';
    if (run.status === 'failed' && !run.result) run.result = err.trim().slice(-400) || `claude exited ${code}`;
    runs.delete(id);
    last.set(id, run);
    emit({type: 'claude', project: id, status: run.status, result: run.result});
  });
  return run;
};

export const stopClaude = (id: string) => {
  const r = runs.get(id);
  if (!r) throw new Error('nothing is running');
  r.run.status = 'stopped';
  r.proc.kill('SIGTERM');
  return {stopped: true};
};
