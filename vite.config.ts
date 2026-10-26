import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Recorded with every trial next to the engine's hash; uncommitted changes don't show here.
function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  // Relative URLs, so the same build works under the GitHub Pages project path and locally.
  base: './',
  define: {
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  resolve: {
    alias: {
      'doom-engine-build': fileURLToPath(new URL('./src/engine/build', import.meta.url)),
    },
  },
});
