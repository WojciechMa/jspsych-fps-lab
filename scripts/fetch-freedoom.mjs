// Downloads the pinned Freedoom release (src/paradigms/iwad.json), checks its SHA-256 and puts
// freedoom2.wad and Freedoom's licence files into public/wads, for npm run build:iwad.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib/zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wadDir = resolve(root, 'public/wads');
const { source } = JSON.parse(readFileSync(resolve(root, 'src/paradigms/iwad.json'), 'utf8'));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const folder = `freedoom-${source.release}`;
const FILES = { [`${folder}/${source.name}`]: source.name, [`${folder}/COPYING.txt`]: 'freedoom-COPYING.txt', [`${folder}/CREDITS.txt`]: 'freedoom-CREDITS.txt' };

const wadPath = resolve(wadDir, source.name);
if (existsSync(wadPath) && sha256(readFileSync(wadPath)) === source.sha256 && Object.values(FILES).every((f) => existsSync(resolve(wadDir, f)))) {
  console.log(`public/wads already has Freedoom ${source.release}.`);
  process.exit(0);
}

console.log(`Downloading ${source.url}`);
let zip;
try {
  const response = await fetch(source.url);
  if (!response.ok) fail(`Download failed: HTTP ${response.status}.`);
  zip = Buffer.from(await response.arrayBuffer());
} catch (error) {
  fail(`Download failed: ${error.cause?.message ?? error.message}. Behind a TLS-intercepting proxy, set NODE_OPTIONS=--use-system-ca; if the network requires a proxy, also set HTTPS_PROXY=http://<proxy>:<port> and NODE_USE_ENV_PROXY=1.`);
}
if (sha256(zip) !== source.zip_sha256) {
  fail(`The download is not Freedoom ${source.release} (SHA-256 differs; ${zip.length} bytes). A proxy may have returned a login page instead.`);
}
const entries = readZip(zip);
for (const [entry, file] of Object.entries(FILES)) {
  const found = entries.find((e) => e.name === entry);
  if (!found) fail(`${entry} is missing from the archive.`);
  writeFileSync(resolve(wadDir, file), found.read());
  console.log(`Wrote public/wads/${file}`);
}
if (sha256(readFileSync(wadPath)) !== source.sha256) fail(`${source.name} from the archive doesn't match iwad.json.`);
