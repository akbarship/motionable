import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { mcp: 'src/mcp/server.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  platform: 'node',
  target: 'node22',
  // Self-contained bundle: dist/*.js run without node_modules (plugin installs ship dist only).
  noExternal: [/.*/],
  // Bundled CommonJS deps (e.g. ajv under the MCP SDK) call require(); give ESM output one.
  // One id per build, shared by dist/mcp.js and dist/cli.js, so studio_open can spot a Studio left from an older build.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  banner: { js: "import { createRequire as __mcr } from 'node:module'; const require = __mcr(import.meta.url);" },
});
