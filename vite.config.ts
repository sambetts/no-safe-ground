import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is a single self-contained index.html, so the game can be
// opened straight from disk (double-click) or dropped onto any static host.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5317,
  },
});
