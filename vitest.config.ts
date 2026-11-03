import os from 'node:os';
import path from 'node:path';
import {defineConfig} from 'vitest/config';

// tests never read or write the user's own lessons and keys
export default defineConfig({test: {env: {MOTIONABLE_STATE: path.join(os.tmpdir(), `motionable-test-state-${process.pid}`)}}});
