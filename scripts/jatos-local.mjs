// Local JATOS for testing study archives: `npm run jatos:local -- [start|stop|reset]`.
import { spawnSync } from 'node:child_process';
import { containerEngine } from './container.mjs';

const JATOS_IMAGE = 'docker.io/jatos/jatos:3.11.3';
const CONTAINER = 'jspsych-fps-lab-jatos';
const VOLUME = 'jspsych-fps-lab-jatos-data';
const engine = containerEngine();

function run(...args) {
  console.log(`> ${engine} ${args.join(' ')}`);
  const result = spawnSync(engine, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function containerExists() {
  return spawnSync(engine, ['container', 'inspect', CONTAINER], { stdio: 'ignore' }).status === 0;
}

const command = process.argv[2] ?? 'start';
if (command === 'start') {
  if (containerExists()) run('start', CONTAINER);
  // Bound to 127.0.0.1: a fresh JATOS has the login admin/admin.
  else run('run', '-d', '--name', CONTAINER, '-p', '127.0.0.1:9000:9000', '-v', `${VOLUME}:/opt/jatos_data`, JATOS_IMAGE);
  console.log('JATOS starts at http://localhost:9000 (first login admin / admin).');
} else if (command === 'stop') {
  if (containerExists()) run('stop', CONTAINER);
} else if (command === 'reset') {
  if (containerExists()) run('rm', '-f', CONTAINER);
  run('volume', 'rm', '-f', VOLUME);
} else {
  console.error(`Unknown command "${command}". Use start, stop or reset.`);
  process.exit(1);
}
