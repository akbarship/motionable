// Connect this Motionable checkout to your Claude Code, for every folder you open Claude in:
// the MCP server (user scope) and the skill (a link in ~/.claude/skills). Run: npm run connect
// (Opening `claude` inside this folder works without it: .mcp.json and .claude/skills are picked up there.)
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const claude = (args) => spawnSync('claude', args, {encoding: 'utf8', shell: process.platform === 'win32'});

if (claude(['--version']).status !== 0) {
  console.error('Claude Code (the `claude` command) was not found. Install it first: https://claude.com/claude-code');
  process.exit(1);
}
if (!fs.existsSync(path.join(repo, 'node_modules', 'tsx'))) {
  console.error('Run `npm install` in this folder first.');
  process.exit(1);
}
claude(['mcp', 'remove', '-s', 'user', 'motionable']); // re-run safe: replace an older entry
// this Node by its full path (the installer's portable Node isn't on PATH), the same launcher as .mcp.json
const add = claude(['mcp', 'add', '-s', 'user', 'motionable', '--', process.execPath, path.join(repo, 'scripts', 'mcp.mjs')]);
if (add.status !== 0) {
  console.error(add.stderr || add.stdout);
  process.exit(1);
}
const skills = path.join(os.homedir(), '.claude', 'skills');
const link = path.join(skills, 'motionable');
fs.mkdirSync(skills, {recursive: true});
fs.rmSync(link, {recursive: true, force: true});
try {
  fs.symlinkSync(path.join(repo, 'skills', 'motionable'), link, 'junction');
} catch {
  fs.cpSync(path.join(repo, 'skills', 'motionable'), link, {recursive: true}); // no symlinks allowed: a copy
}
console.log('Motionable is connected to Claude Code (MCP server + skill). In Claude Code, type /motionable.');
