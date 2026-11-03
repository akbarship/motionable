import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// dev: the daemon (4377) serves the API, live events and the project pages; the build is served by the daemon itself
const daemon = 'http://127.0.0.1:4377';
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {port: 5173, strictPort: true, proxy: {'/api': daemon, '/p': daemon, '/hf-runtime.js': daemon}},
  build: {outDir: 'dist', emptyOutDir: true},
});
