import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs, so the same build works under the GitHub Pages project path and locally.
  base: './',
  resolve: {
    alias: {
      'doom-engine-build': fileURLToPath(new URL('./src/engine/build', import.meta.url)),
    },
  },
});
