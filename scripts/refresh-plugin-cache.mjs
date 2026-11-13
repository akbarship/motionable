// Copies the built plugin into Claude Code's plugin cache without running the `claude` CLI
// (no login/token side effects while other Claude sessions are open). Run after `npm run build`.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const index = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
let target = null;
try {
  target = JSON.parse(readFileSync(index, 'utf8')).plugins?.['motionable@motionable']?.[0]?.installPath ?? null;
} catch {
  // no index yet
}
if (!target || !existsSync(target)) {
  console.error('Motionable is not installed yet. Install once: claude plugin install motionable@motionable --scope user');
  process.exit(1);
}
for (const item of ['agents', 'skills', 'dist', '.claude-plugin', '.mcp.json', 'package.json']) {
  const from = join(repo, item);
  if (!existsSync(from)) continue;
  rmSync(join(target, item), { recursive: true, force: true });
  cpSync(from, join(target, item), { recursive: true });
}
console.log(`plugin cache updated: ${target}`);
console.log('Restart Claude Code (or /reload-plugins) to load it.');
