// Seeded grid mazes and their Doom map geometry. A maze is a perfect maze (exactly one route
// between any two cells) carved by a randomized depth-first search; its map is a block grid of
// cells and passages separated by walls and pillars.
import { gridGeometry } from './grid.mjs';

export const MAZE_GENERATOR = 'dfs-mulberry32@1';

const DIRECTIONS = [
  { dc: 1, dr: 0, angle: 0 }, // east
  { dc: 0, dr: 1, angle: 90 }, // north (+y)
  { dc: -1, dr: 0, angle: 180 }, // west
  { dc: 0, dr: -1, angle: 270 }, // south
];

/** Deterministic 32-bit PRNG; the same seed always gives the same maze. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Carves a cols × rows maze from `start`. Returns the open passages as [c1, r1, c2, r2] with the
 * lower cell first, the goal (the cell farthest from the start, always a dead end) and the
 * shortest route from start to goal.
 */
export function generateMaze({ cols, rows, seed, start = [0, 0] }) {
  if (!(Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && rows >= 2 && cols * rows <= 400)) {
    throw new Error(`Maze size ${cols}×${rows}: use whole numbers ≥ 2 and at most 400 cells.`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`Maze seed ${seed}: use a 32-bit unsigned integer.`);
  const [sc, sr] = start;
  if (!(sc >= 0 && sc < cols && sr >= 0 && sr < rows)) throw new Error(`Maze start [${start}] is outside ${cols}×${rows}.`);

  const random = mulberry32(seed);
  const index = (c, r) => r * cols + c;
  const visited = new Uint8Array(cols * rows);
  const links = Array.from({ length: cols * rows }, () => []);
  const stack = [[sc, sr]];
  visited[index(sc, sr)] = 1;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const options = DIRECTIONS.map(({ dc, dr }) => [c + dc, r + dr]).filter(
      ([nc, nr]) => nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[index(nc, nr)],
    );
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nc, nr] = options[Math.floor(random() * options.length)];
    visited[index(nc, nr)] = 1;
    links[index(c, r)].push(index(nc, nr));
    links[index(nc, nr)].push(index(c, r));
    stack.push([nc, nr]);
  }

  // Breadth-first distances from the start; ties for the goal go to the lowest cell index.
  const distance = new Int32Array(cols * rows).fill(-1);
  const previous = new Int32Array(cols * rows).fill(-1);
  const queue = [index(sc, sr)];
  distance[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    for (const next of links[cell]) {
      if (distance[next] >= 0) continue;
      distance[next] = distance[cell] + 1;
      previous[next] = cell;
      queue.push(next);
    }
  }
  let goal = 0;
  for (let cell = 1; cell < cols * rows; cell++) if (distance[cell] > distance[goal]) goal = cell;
  const route = [];
  for (let cell = goal; cell >= 0; cell = previous[cell]) route.unshift([cell % cols, Math.floor(cell / cols)]);

  const passages = [];
  links.forEach((neighbours, cell) => {
    for (const next of neighbours) {
      if (next > cell) passages.push([cell % cols, Math.floor(cell / cols), next % cols, Math.floor(next / cols)]);
    }
  });
  passages.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[3] - b[3] || a[2] - b[2]);
  return { cols, rows, start: [sc, sr], goal: [goal % cols, Math.floor(goal / cols)], route, passages };
}

/**
 * Doom geometry of a maze. Sector index = row * cols + col; a passage belongs to the cell with
 * the lower column (east–west) or row (north–south), except that the goal's passage belongs to
 * its neighbour, so the goal sector is exactly the goal cell. Cell (c, r) spans x from
 * wall + c * (cell + wall) for `cell` units, and likewise y; +y is north.
 */
export function mazeGeometry(maze, style) {
  const { cols, rows } = maze;
  const { cell, wall, floor, ceiling, light, wallTexture, goalTexture, floorFlat, ceilingFlat, goalFlat, startTag, goalTag } = style;
  const open = new Set(maze.passages.map(([c1, r1, c2, r2]) => `${c1},${r1},${c2},${r2}`));
  const goalSector = maze.goal[1] * cols + maze.goal[0];
  const startSector = maze.start[1] * cols + maze.start[0];
  const owner = (lower, upper) => (lower === goalSector ? upper : lower);

  // Blocks: odd indexes are cells, even ones walls; (even, even) blocks are pillars.
  const BW = 2 * cols + 1;
  const BH = 2 * rows + 1;
  const offset = (i) => (i >> 1) * (cell + wall) + (i & 1 ? wall : 0);
  const size = (i) => (i & 1 ? cell : wall);
  const sectorOf = (i, j) => {
    if (i <= 0 || j <= 0 || i >= BW - 1 || j >= BH - 1) return -1;
    const c = (i - 1) >> 1;
    const r = (j - 1) >> 1;
    const s = r * cols + c;
    if (i & 1 && j & 1) return s;
    if (!(i & 1) && j & 1) return open.has(`${c},${r},${c + 1},${r}`) ? owner(s, s + 1) : -1;
    if (i & 1 && !(j & 1)) return open.has(`${c},${r},${c},${r + 1}`) ? owner(s, s + cols) : -1;
    return -1;
  };

  const { vertices, linedefs, sidedefs } = gridGeometry({
    widths: Array.from({ length: BW }, (_, i) => size(i)),
    heights: Array.from({ length: BH }, (_, j) => size(j)),
    sectorAt: sectorOf,
    twoSided: (front, back) => ({
      flags: 4, // two-sided
      special: front === goalSector || back === goalSector ? 52 : 0, // W1 exit level
    }),
    wallTexture: (sector) => (sector === goalSector ? goalTexture : wallTexture),
  });

  const sectors = Array.from({ length: cols * rows }, (_, s) => ({
    floor,
    ceiling,
    floorFlat: s === goalSector ? goalFlat : floorFlat,
    ceilingFlat,
    light,
    special: 0,
    tag: s === startSector ? startTag : s === goalSector ? goalTag : 0,
  }));

  // Player 1 faces the start cell's first open passage (east, north, west, south).
  const [sc, sr] = maze.start;
  const facing = DIRECTIONS.find(({ dc, dr }) => {
    const [c1, r1, c2, r2] = [sc, sr, sc + dc, sr + dr];
    return open.has(`${c1},${r1},${c2},${r2}`) || open.has(`${c2},${r2},${c1},${r1}`);
  });
  const things = [
    { x: offset(2 * sc + 1) + cell / 2, y: offset(2 * sr + 1) + cell / 2, angle: facing.angle, type: 1, flags: 7 },
  ];
  return { things, linedefs, sidedefs, vertices, sectors };
}
