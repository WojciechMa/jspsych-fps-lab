import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Recorded with every trial next to the engine's hash; uncommitted changes don't show here.
function gitCommit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Dev-only WADs in public/wads: production loads the trimmed IWAD (npm run build:iwad).
const DEV_ONLY_WADS = ['miniwad.wad', 'miniwad-LICENSE.txt', 'freedoom2.wad', 'freedoom2.wad.gz'];

function dropDevWads(): Plugin {
  let outDir = '';
  return {
    name: 'drop-dev-wads',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const name of DEV_ONLY_WADS) rmSync(resolve(outDir, 'wads', name), { force: true });
    },
  };
}

export default defineConfig({
  // Relative URLs, so the same build works under the GitHub Pages project path and locally.
  base: './',
  plugins: [dropDevWads()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
  resolve: {
    alias: {
      'doom-engine-build': fileURLToPath(new URL('./src/engine/build', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        builder: fileURLToPath(new URL('./builder.html', import.meta.url)),
      },
    },
  },
});
