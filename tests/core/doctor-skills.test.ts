import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { missingSkills } from '../../src/cli.js';

test('missingSkills lists skills absent from the claude dir', async () => {
  const d = mkdtempSync(join(tmpdir(), 'mo-skills-'));
  expect(await missingSkills(d)).toEqual(['hyperframes', 'hyperframes-cli', 'hyperframes-registry']);
  mkdirSync(join(d, 'skills', 'hyperframes'), { recursive: true });
  expect(await missingSkills(d)).toEqual(['hyperframes-cli', 'hyperframes-registry']);
});
