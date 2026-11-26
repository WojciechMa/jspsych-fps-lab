// Builds the study PWADs from the map definitions in maps/*.json: generates each map's geometry,
// runs the ZDBSP node builder (vanilla nodes) in a Debian container, and writes the WADs plus
// public/wads/manifest.json (hashes, map slots and names, ROI names, generator details).
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInContainer } from './container.mjs';
import { BANDIT_GENERATOR, banditGeometry, LEFT_TAG, RIGHT_TAG, START_TAG } from './lib/bandit.mjs';
import { CORRIDOR_GENERATOR, corridorGeometry } from './lib/corridor.mjs';
import { generateMaze, MAZE_GENERATOR, mazeGeometry } from './lib/maze.mjs';
import { mapLumps, readWad, writeWad } from './lib/wad.mjs';

const DEBIAN_IMAGE = 'docker.io/library/debian:trixie-slim';
const ZDBSP = 'zdbsp=1.19+20181027+dfsg.1-4';

const MAZE_STYLE = {
  cell: 128,
  wall: 16,
  floor: 0,
  ceiling: 128,
  light: 192,
  wallTexture: 'GRAY1',
  goalTexture: 'EXITSTON',
  floorFlat: 'FLOOR4_8',
  ceilingFlat: 'CEIL3_5',
  goalFlat: 'GATE1',
  startTag: 900,
  goalTag: 901,
};

const CORRIDOR_STYLE = {
  width: 256,
  alcoveWidth: 128,
  alcoveDepth: 96,
  gap: 192,
  startLength: 256,
  floor: 0,
  ceiling: 128,
  light: 192,
  wallTexture: 'GRAY1',
  floorFlat: 'FLOOR4_8',
  ceilingFlat: 'CEIL3_5',
};

const BANDIT_STYLE = {
  width: 640,
  doorWidth: 128,
  gap: 128,
  startDepth: 384,
  passageDepth: 32,
  roomDepth: 192,
  floor: 0,
  ceiling: 128,
  doorCeiling: 104,
  light: 192,
  roomLight: 160,
  wallTexture: 'GRAY1',
  jambTexture: 'DOORTRAK',
  floorFlat: 'FLOOR4_8',
  ceilingFlat: 'CEIL3_5',
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'maps');
const work = resolve(root, 'engine/build/maps');
const outDir = resolve(root, 'public/wads');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function buildMaze(definition, map) {
  const maze = generateMaze({ cols: map.cols, rows: map.rows, seed: map.seed, start: map.start ?? [0, 0] });
  const geometry = mazeGeometry(maze, MAZE_STYLE);
  const info = {
    slot: map.slot,
    name: map.name,
    paradigm: definition.paradigm,
    rois: { [MAZE_STYLE.startTag]: 'start', [MAZE_STYLE.goalTag]: 'goal' },
    maze: {
      generator: MAZE_GENERATOR,
      seed: map.seed,
      cols: maze.cols,
      rows: maze.rows,
      cell: MAZE_STYLE.cell,
      wall: MAZE_STYLE.wall,
      sector: 'row * cols + col',
      start: maze.start,
      goal: maze.goal,
      route_cells: maze.route.length,
      route: maze.route,
      passages: maze.passages,
    },
  };
  return { lumps: mapLumps(map.slot, geometry), info };
}

function buildCorridor(definition, map) {
  const geometry = corridorGeometry({ pairs: map.pairs }, CORRIDOR_STYLE);
  const info = {
    slot: map.slot,
    name: map.name,
    paradigm: definition.paradigm,
    rois: {},
    corridor: {
      generator: CORRIDOR_GENERATOR,
      pairs: map.pairs,
      width: CORRIDOR_STYLE.width,
      length: geometry.length,
      alcove_width: CORRIDOR_STYLE.alcoveWidth,
      alcove_depth: CORRIDOR_STYLE.alcoveDepth,
      player: geometry.player,
      spots: geometry.spots,
    },
  };
  return { lumps: mapLumps(map.slot, geometry), info };
}

function buildBandit(definition, map) {
  const geometry = banditGeometry(BANDIT_STYLE);
  const info = {
    slot: map.slot,
    name: map.name,
    paradigm: definition.paradigm,
    rois: { [START_TAG]: 'start', [LEFT_TAG]: 'left', [RIGHT_TAG]: 'right' },
    bandit: {
      generator: BANDIT_GENERATOR,
      width: BANDIT_STYLE.width,
      player: geometry.player,
      doors: geometry.doors,
    },
  };
  return { lumps: mapLumps(map.slot, geometry), info };
}

const BUILDERS = { maze: buildMaze, 'threat-corridor': buildCorridor, 'two-door-bandit': buildBandit };

const definitions = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({ file: `maps/${file}`, ...JSON.parse(readFileSync(resolve(sourceDir, file), 'utf8')) }));

rmSync(work, { recursive: true, force: true });
mkdirSync(resolve(work, 'src'), { recursive: true });
mkdirSync(resolve(work, 'out'), { recursive: true });

const built = [];
const wadNames = new Set();
for (const definition of definitions) {
  if (!/^[a-z0-9-]+\.wad$/.test(definition.wad ?? '')) fail(`${definition.file}: "wad" must match ^[a-z0-9-]+\\.wad$.`);
  if (wadNames.has(definition.wad)) fail(`${definition.file}: ${definition.wad} is defined twice.`);
  wadNames.add(definition.wad);
  const build = Object.hasOwn(BUILDERS, definition.paradigm) ? BUILDERS[definition.paradigm] : null;
  if (!build) fail(`${definition.file}: no generator for paradigm "${definition.paradigm}".`);
  const slots = new Set();
  const names = new Set();
  const maps = definition.maps.map((map) => {
    if (!(Number.isInteger(map.slot) && map.slot >= 1 && map.slot <= 32)) fail(`${definition.file}: ${map.name}: slot must be 1–32.`);
    if (!/^[a-z0-9-]+$/.test(map.name ?? '')) fail(`${definition.file}: map name "${map.name}" must match ^[a-z0-9-]+$.`);
    if (slots.has(map.slot) || names.has(map.name)) fail(`${definition.file}: duplicate slot or name at ${map.name}.`);
    slots.add(map.slot);
    names.add(map.name);
    try {
      return build(definition, map);
    } catch (error) {
      return fail(`${definition.file}: ${map.name}: ${error.message}`);
    }
  });
  writeFileSync(resolve(work, 'src', definition.wad), writeWad('PWAD', maps.flatMap((map) => map.lumps)));
  built.push({ definition, maps: maps.map((map) => map.info) });
}

// -q keeps unused sectors and sidedefs, so sector numbers stay as generated (maze: row * cols +
// col); -R writes a
// zero-filled REJECT; -t leaves out timing output. Without -X/-z the nodes stay vanilla.
runInContainer(DEBIAN_IMAGE, {
  mounts: { [work]: '/work' },
  workdir: '/work',
  command: [
    'sh', '-c',
    'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq'
      + ` --no-install-recommends ${ZDBSP} > /dev/null`
      + ' && for f in src/*.wad; do zdbsp -q -R -t -o "out/$(basename "$f")" "$f" || exit 1; done',
  ],
});

const RECORD = { SEGS: 12, SSECTORS: 4, NODES: 28, REJECT: 1, BLOCKMAP: 2 };
const manifest = { $comment: 'Written by npm run build:maps from maps/*.json; do not edit.', wads: {} };
for (const { definition, maps } of built) {
  const data = readFileSync(resolve(work, 'out', definition.wad));
  const { lumps } = readWad(data);
  for (const map of maps) {
    const at = lumps.findIndex((lump) => lump.name === `MAP${String(map.slot).padStart(2, '0')}`);
    for (const [name, size] of Object.entries(RECORD)) {
      const lump = lumps.slice(at + 1, at + 11).find((l) => l.name === name);
      if (!lump || !lump.data.length || lump.data.length % size) fail(`${definition.wad} ${map.name}: bad ${name} lump from the node builder.`);
    }
  }
  copyFileSync(resolve(work, 'out', definition.wad), resolve(outDir, definition.wad));
  manifest.wads[definition.wad] = {
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    source: definition.file,
    node_builder: ZDBSP.replace('=', ' '),
    maps,
  };
  console.log(`Wrote public/wads/${definition.wad} (${data.length} bytes, ${maps.length} maps)`);
}
// One line per number array (routes, passages), so the manifest stays readable.
const json = JSON.stringify(manifest, null, 2).replace(/\[\s*(-?\d+(?:,\s*-?\d+)*)\s*\]/g, (_, inner) => `[${inner.split(/,\s*/).join(', ')}]`);
writeFileSync(resolve(outDir, 'manifest.json'), `${json}\n`);
console.log('Wrote public/wads/manifest.json');
