// The MCP server's entry for Claude Code, the same on Linux, macOS and Windows: plain Node loads TypeScript through
// tsx's API in this process (node_modules/.bin holds shell scripts Windows can't start). Before `npm install` the
// tools can't exist: say so on stderr, where Claude Code shows it, instead of a stack trace.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(repo, 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs');
if (!fs.existsSync(api)) {
  console.error(`Motionable isn't installed yet: run \`npm run setup\` in ${repo} (or type /motionable and Claude does it), then reconnect.`);
  process.exit(1);
}
const {register} = await import(pathToFileURL(api).href);
register();
await import(pathToFileURL(path.join(repo, 'apps', 'mcp', 'src', 'main.ts')).href);
