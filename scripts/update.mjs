// Update this checkout in place: the newest code, its packages, the Studio build, then the running server restarts
// (it reads the code only when it starts). Run: npm run update. The installers do the same when run again.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {cwd: repo, stdio: 'inherit', shell: process.platform === 'win32'});
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!fs.existsSync(path.join(repo, '.git'))) {
  console.error('This copy has no git history: run the installer again to update it.');
  process.exit(1);
}
run('git', ['pull', '--ff-only']);
run('npm', ['ci', '--no-audit', '--no-fund']);
run('npm', ['run', '-s', 'build']);
const state = process.env.MOTIONABLE_STATE ?? path.join(os.homedir(), '.motionable');
try {
  const d = JSON.parse(fs.readFileSync(path.join(state, 'daemon.json'), 'utf8'));
  await fetch(`http://127.0.0.1:${d.port}/api/restart`, {method: 'POST'});
} catch {} // not running: the next /motionable starts the new code
console.log('Motionable is up to date.');
