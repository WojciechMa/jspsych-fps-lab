// Builds the trimmed IWAD (src/paradigms/iwad.json) from Freedoom Phase 2's freedoom2.wad in
// public/wads: the listed classic maps plus what the map WADs in public/wads/manifest.json need,
// gzipped to public/wads/<name>.gz. Fails if the input or output differs from the pinned SHA-256;
// --update writes the new output hash into iwad.json instead.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { engineTables, trimIwad, wadResources } from './lib/iwad.mjs';
import { readWad, writeWad } from './lib/wad.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'src/paradigms/iwad.json');
const wadDir = resolve(root, 'public/wads');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const update = process.argv.includes('--update');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!/^[a-z0-9-]+\.wad$/.test(config.name)) fail(`iwad.json: "name" must match ^[a-z0-9-]+\\.wad$.`);

let source;
try {
  source = readFileSync(resolve(wadDir, config.source.name));
} catch {
  fail(`public/wads/${config.source.name} is missing: run npm run fetch:freedoom.`);
}
if (sha256(source) !== config.source.sha256) fail(`public/wads/${config.source.name} is not Freedoom ${config.source.release} (SHA-256 differs): run npm run fetch:freedoom.`);

const manifest = JSON.parse(readFileSync(resolve(wadDir, 'manifest.json'), 'utf8'));
const pwadResources = { textures: new Set(), flats: new Set() };
for (const [name, entry] of Object.entries(manifest.wads)) {
  const data = readFileSync(resolve(wadDir, name));
  if (sha256(data) !== entry.sha256) fail(`public/wads/${name} doesn't match manifest.json: run npm run build:maps.`);
  const used = wadResources(readWad(data).lumps);
  used.textures.forEach((t) => pwadResources.textures.add(t));
  used.flats.forEach((f) => pwadResources.flats.add(f));
}

let trimmed;
try {
  trimmed = trimIwad(readWad(source).lumps, { maps: config.maps, pwadResources, tables: engineTables(resolve(root, 'engine/doomgeneric')) });
} catch (error) {
  fail(`iwad.json: ${error.message}`);
}
const wad = writeWad('IWAD', trimmed.lumps);
const hash = sha256(wad);
if (hash !== config.sha256) {
  if (!update) fail(`${config.name}: SHA-256 ${hash} differs from iwad.json (${config.sha256 || 'none'}). If the change is intended, run npm run build:iwad -- --update.`);
  config.sha256 = hash;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2).replace(/\[\s*(\d+(?:,\s*\d+)*)\s*\]/g, (_, inner) => `[${inner.split(/,\s*/).join(', ')}]`)}\n`);
  console.log(`Updated the SHA-256 in src/paradigms/iwad.json`);
}
const gz = gzipSync(wad, { level: 9 });
writeFileSync(resolve(wadDir, `${config.name}.gz`), gz);
console.log(
  `Wrote public/wads/${config.name}.gz: ${(gz.length / 1e6).toFixed(2)} MB gzipped (${(wad.length / 1e6).toFixed(2)} MB), ` +
    `maps ${config.maps.join(', ')}, ${trimmed.textures} textures, ${trimmed.patches} patches, ${trimmed.flats} flats.`,
);
