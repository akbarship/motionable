// The MCP shim: Claude Code's tools, forwarded to the local daemon (started here if it isn't running).
// Results are compact JSON; descriptions are one sentence (rule 4: minimise tokens).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE = path.join(process.env.MOTIONABLE_STATE ?? path.join(os.homedir(), '.motionable'), 'daemon.json');
const PORT = Number(process.env.MOTIONABLE_PORT ?? 4377);

const base = () => {
  try {
    return `http://127.0.0.1:${JSON.parse(fs.readFileSync(STATE, 'utf8')).port}`;
  } catch {
    return `http://127.0.0.1:${PORT}`;
  }
};
const alive = async () => fetch(`${base()}/api/health`).then((r) => r.ok, () => false);

const ensureDaemon = async () => {
  if (await alive()) return;
  const tsx = path.join(REPO, 'node_modules', '.bin', 'tsx');
  const log = fs.openSync(path.join(os.tmpdir(), 'motionable-daemon.log'), 'a');
  spawn(tsx, [path.join(REPO, 'apps/daemon/src/boot.ts')], {detached: true, stdio: ['ignore', log, log], env: process.env}).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await alive()) return;
  }
  throw new Error('the Motionable daemon did not start (see motionable-daemon.log in the temp folder)');
};

const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
  await ensureDaemon();
  const r = await fetch(`${base()}${url}`, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `daemon ${r.status}`);
  return j;
};
const out = (v: unknown) => ({content: [{type: 'text' as const, text: JSON.stringify(v)}]});
const fail = (e: unknown) => ({content: [{type: 'text' as const, text: JSON.stringify({error: String((e as Error).message ?? e)})}], isError: true});
const tool = <T>(fn: (a: T) => Promise<unknown>) => async (a: T) => {
  try {
    return out(await fn(a));
  } catch (e) {
    return fail(e);
  }
};

// the plan version Claude last saw per project, so get_project_state returns only what changed since then
const seen = new Map<string, number>();

const server = new McpServer({name: 'motionable', version: '0.1.0'});

server.registerTool('list', {description: 'List projects (style, plan version) and styles (versions, references, components).', inputSchema: {}},
  tool(async () => call('GET', '/api/list')));

server.registerTool('get_project_state', {
  description: 'Compact state: changes since your last look, the user\'s files, open notes (do these first) and lessons; cuts: true adds retake/filler candidates.',
  inputSchema: {project: z.string(), since: z.number().int().optional(), cuts: z.boolean().optional().describe('add cut candidates: range.cut the sure ones, range.suggest the rest')},
}, tool(async ({project, since, cuts}: {project: string; since?: number; cuts?: boolean}) => {
  const s = await call('GET', `/api/projects/${project}/state?since=${since ?? seen.get(project) ?? 0}`);
  seen.set(project, s.version);
  return cuts ? {...s, cuts: await call('GET', `/api/projects/${project}/cuts`)} : s;
}));

server.registerTool('create_project', {
  description: 'Create a project from the user\'s video files (joined in this order) and start the free analysis.',
  inputSchema: {files: z.array(z.string()).min(1).describe('absolute paths'), title: z.string().optional()},
}, tool(async ({files, title}: {files: string[]; title?: string}) => call('POST', '/api/projects', {files, title})));

server.registerTool('transcribe', {
  description: 'Paid: transcribe with ElevenLabs Scribe on the user\'s key. Ask the user before calling.',
  inputSchema: {project: z.string()},
}, tool(async ({project}: {project: string}) => call('POST', `/api/projects/${project}/transcribe`, {})));

const picture = async (body: unknown) => {
  try {
    const r = await call('POST', '/api/look', body);
    return {content: [{type: 'image' as const, data: r.image, mimeType: r.mime}, {type: 'text' as const, text: JSON.stringify(r.info)}]};
  } catch (e) {
    return fail(e);
  }
};

server.registerTool('look', {
  description: 'One picture: a project or reference contact sheet; frames over from–to; project+plan = the edit as it is now; project+style = the footage in that style (specimen).',
  inputSchema: {
    project: z.string().optional(), style: z.string().optional().describe('name, or name@version for a specimen'), ref: z.string().optional(),
    plan: z.boolean().optional().describe('project only: frames of the current edit'),
    from: z.number().optional(), to: z.number().optional(), n: z.number().int().optional().describe('frames, up to 16'),
    ops: z.array(z.object({op: z.string()}).passthrough()).optional().describe('specimen only: ops applied to the scratch plan'),
  },
}, (a: Record<string, unknown>) => picture(a));

server.registerTool('study_reference', {
  description: 'Copy reference reels into a style and measure them (cuts, pacing); then look at each with look {style, ref}.',
  inputSchema: {style: z.string().describe('style name'), files: z.array(z.string()).min(1).describe('absolute paths')},
}, tool(async ({style, files}: {style: string; files: string[]}) => call('POST', `/api/styles/${style}/refs`, {files})));

server.registerTool('save_style', {
  description: 'Save style.json (motionable.style/1, refs + sources required) and a brief of at most 30 lines.',
  inputSchema: {style: z.object({name: z.string(), version: z.number().int()}).passthrough(), brief: z.string()},
}, tool(async ({style, brief}: {style: Record<string, unknown>; brief: string}) => call('POST', '/api/styles/save', {style, brief})));

server.registerTool('write_component', {
  description: 'Write a component (component.json + component.js per the contract) and run the gate; returns the report and its sheet.',
  inputSchema: {style: z.string().describe('name@version'), manifest: z.object({name: z.string(), version: z.number().int()}).passthrough(), code: z.string()},
}, async ({style, manifest, code}: {style: string; manifest: Record<string, unknown>; code: string}) => {
  try {
    const r = await call('POST', `/api/styles/${style}/components`, {manifest, code});
    const {image, mime, ...report} = r;
    return {content: [{type: 'text' as const, text: JSON.stringify(report)}, ...(image ? [{type: 'image' as const, data: image, mimeType: mime}] : [])]};
  } catch (e) {
    return fail(e);
  }
});

server.registerTool('scaffold_plan', {
  description: 'Start the plan from a style: pauses trimmed, one shot, one caption line per word.',
  inputSchema: {project: z.string(), style: z.string().describe('name@version')},
}, tool(async ({project, style}: {project: string; style: string}) => {
  const r = await call('POST', `/api/projects/${project}/scaffold`, {style});
  seen.set(project, r.version);
  return r;
}));

server.registerTool('add_lesson', {
  description: 'Keep what the user rejected, in their words; a rule (forbid, max_per_minute, min_hold, no_behind_subject) makes apply_ops enforce it.',
  inputSchema: {
    text: z.string().describe('the user\'s own words, one sentence'),
    scope: z.string().optional().describe('"global" (default) or "style:<name>"'),
    rule: z.object({kind: z.enum(['forbid', 'max_per_minute', 'min_hold', 'no_behind_subject'])}).passthrough().optional()
      .describe('forbid {component} | max_per_minute {what: shot|overlay|transition|<component>, n} | min_hold {role, s} | no_behind_subject'),
  },
}, tool(async ({text, scope, rule}: {text: string; scope?: string; rule?: Record<string, unknown>}) =>
  call('POST', '/api/lessons', {text, scope: scope ?? 'global', rule, source: 'claude'})));

server.registerTool('apply_ops', {
  description: 'Apply one all-or-nothing batch of plan operations; returns the new version and warnings.',
  inputSchema: {
    project: z.string(),
    base: z.number().int().describe('plan version the ops were written against'),
    why: z.string(),
    ops: z.array(z.object({op: z.string()}).passthrough()),
  },
}, tool(async ({project, base: b, why, ops}: {project: string; base: number; why: string; ops: {op: string}[]}) => {
  const r = await call('POST', `/api/projects/${project}/ops`, {base: b, by: {kind: 'mcp'}, why, ops});
  seen.set(project, r.version);
  return r;
}));

server.registerTool('render', {
  description: 'Render the current plan to MP4 in the background (draft, looks or delivery).',
  inputSchema: {project: z.string(), quality: z.enum(['draft', 'looks', 'delivery', 'export']).optional().describe('export: delivery render, −14 LUFS, SRT, into My videos')},
}, tool(async ({project, quality}: {project: string; quality?: string}) => call('POST', `/api/projects/${project}/render`, {quality})));

// the core set stays at 12 tools (rule 4); the rest only with MOTIONABLE_MCP_FULL=1
if (process.env.MOTIONABLE_MCP_FULL === '1') {
  server.registerTool('open_studio', {description: 'Return the Studio URL for the user to open.', inputSchema: {}},
    tool(async () => {
      await ensureDaemon();
      return {url: base()};
    }));
}

await server.connect(new StdioServerTransport());
