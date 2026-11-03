// npm run setup: saves the data folder and language for onboarding, says what's next, and never prints a key.
import {describe, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const setup = (state: string, ...args: string[]) =>
  spawnSync(process.execPath, ['scripts/setup.mjs', ...args], {encoding: 'utf8', env: {...process.env, MOTIONABLE_STATE: state}});

describe('setup', () => {
  it('saves the folder and language, keeps keys out of the output', () => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-setup-'));
    fs.writeFileSync(path.join(state, 'config.json'), JSON.stringify({keys: {elevenlabs: 'sk_secret9876'}}));
    expect(JSON.parse(setup(state).stdout).next).toMatch(/language/);
    expect(setup(state, '--home', 'relative/dir').status).toBe(1);
    const home = path.join(state, 'videos');
    const r = setup(state, '--home', home, '--lang', 'en');
    const s = JSON.parse(r.stdout);
    expect(s.home).toMatchObject({path: home, chosen: true, exists: true});
    expect(s.lang).toBe('en');
    expect(s.elevenlabs).toBe(true);
    expect(r.stdout).not.toContain('secret');
    expect(JSON.parse(fs.readFileSync(path.join(state, 'config.json'), 'utf8')).keys.elevenlabs).toBe('sk_secret9876');
  }, 60000);
});
