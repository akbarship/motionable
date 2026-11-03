// The daemon's entry: the data folder from the user's settings (unless MOTIONABLE_HOME says otherwise) is set before
// anything reads it, then the daemon itself loads. The desktop app and the MCP shim start this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = process.env.MOTIONABLE_STATE ?? path.join(os.homedir(), '.motionable');
try {
  const c = JSON.parse(fs.readFileSync(path.join(state, 'config.json'), 'utf8')) as {home?: string};
  if (!process.env.MOTIONABLE_HOME && c.home && path.isAbsolute(c.home)) process.env.MOTIONABLE_HOME = c.home;
} catch {} // no settings yet: the default ~/Motionable

await import('./main');
