// Runs build steps in a container: Podman locally, Docker in CI (set CONTAINER_ENGINE to force one).
import { spawnSync } from 'node:child_process';

export function containerEngine() {
  if (process.env.CONTAINER_ENGINE) return process.env.CONTAINER_ENGINE;
  for (const candidate of ['podman', 'docker']) {
    if (spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0) return candidate;
  }
  throw new Error('Neither podman nor docker was found. Install one or set CONTAINER_ENGINE.');
}

export function runInContainer(image, { mounts, workdir, command, asHostUser = false }) {
  const engine = containerEngine();
  const args = ['run', '--rm'];
  // Rootful Docker on Linux would otherwise leave root-owned files in the checkout.
  if (asHostUser && engine === 'docker' && process.platform === 'linux') {
    args.push('--user', `${process.getuid()}:${process.getgid()}`);
  }
  for (const [hostPath, containerPath] of Object.entries(mounts)) {
    args.push('-v', `${hostPath}:${containerPath}`);
  }
  args.push('-w', workdir, image, ...command);

  console.log(`> ${engine} ${args.join(' ')}`);
  const result = spawnSync(engine, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
