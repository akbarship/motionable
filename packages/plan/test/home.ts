// A throwaway MOTIONABLE_HOME for tests: the text fixture copied to a temp folder, with empty media files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const makeHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'motionable-test-'));
  fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/home'), home, {recursive: true});
  for (const project of fs.readdirSync(path.join(home, 'projects'))) {
    const dir = path.join(home, 'projects', project);
    const {assets} = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
    for (const a of Object.values<{path: string}>(assets)) {
      const file = path.join(dir, a.path);
      if (!fs.existsSync(file)) fs.mkdirSync(path.dirname(file), {recursive: true}), fs.writeFileSync(file, '');
    }
  }
  return home;
};
