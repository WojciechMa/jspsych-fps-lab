// Builds public/wads/miniwad.wad from fragglet/miniwad (BSD-3) with deutex, then shrinks it
// with fragglet/wadptr as miniwad's README intends. The clones run on the host; the build
// runs in a Debian container.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContainer } from './container.mjs';

const MINIWAD = { repo: 'https://github.com/fragglet/miniwad.git', commit: '72741cc441ebb5df85d9da49873b4aa575800207' };
const WADPTR = { repo: 'https://github.com/fragglet/wadptr.git', commit: '57e8179b62ecc241bbe750f79d40abf3721ad8f4' };
const DEBIAN_IMAGE = 'docker.io/library/debian:trixie-slim';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = resolve(root, 'engine/build');
const outDir = resolve(root, 'public/wads');

function git(...args) {
  // LF line endings: the sources are built in a Linux container.
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function checkout({ repo, commit }, dir) {
  if (!existsSync(dir)) git('clone', '--quiet', repo, dir);
  git('-C', dir, 'checkout', '--quiet', commit);
}

checkout(MINIWAD, resolve(work, 'miniwad'));
checkout(WADPTR, resolve(work, 'wadptr'));

runInContainer(DEBIAN_IMAGE, {
  mounts: { [work]: '/work' },
  workdir: '/work/miniwad',
  command: [
    'sh', '-c',
    'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq'
      + ' --no-install-recommends deutex gcc libc6-dev make > /dev/null'
      + ' && make -s -C /work/wadptr'
      // Debian installs deutex in /usr/games, which is not on root's PATH.
      + ' && PATH="$PATH:/usr/games" sh build.sh'
      // wadptr asks for confirmation before rewriting an IWAD.
      + ' && echo y | /work/wadptr/wadptr -c miniwad.wad',
  ],
});

mkdirSync(outDir, { recursive: true });
copyFileSync(resolve(work, 'miniwad/miniwad.wad'), resolve(outDir, 'miniwad.wad'));
copyFileSync(resolve(work, 'miniwad/COPYING.adoc'), resolve(outDir, 'miniwad-LICENSE.txt'));
console.log(`Wrote ${resolve(outDir, 'miniwad.wad')}`);
