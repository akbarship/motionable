import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { mcp: 'src/mcp/server.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  outDir: 'dist',
  target: 'node22',
});
