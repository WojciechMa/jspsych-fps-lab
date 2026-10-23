// Builds the WebAssembly engine in the pinned emscripten image.
// Extra arguments go to make, e.g. `npm run build:engine -- clean`.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContainer } from './container.mjs';

const EMSDK_IMAGE = 'docker.io/emscripten/emsdk:6.0.13';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

runInContainer(EMSDK_IMAGE, {
  mounts: { [root]: '/src' },
  workdir: '/src/engine',
  command: ['make', '-j4', ...process.argv.slice(2)],
  asHostUser: true,
});
