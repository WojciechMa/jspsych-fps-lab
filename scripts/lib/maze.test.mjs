import { describe, expect, it } from 'vitest';
import { generateMaze, mazeGeometry, mulberry32 } from './maze.mjs';
import { mapLumps, readWad, writeWad } from './wad.mjs';

const STYLE = {
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

function neighbours(maze) {
  const links = new Map();
  for (const [c1, r1, c2, r2] of maze.passages) {
    const a = `${c1},${r1}`;
    const b = `${c2},${r2}`;
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  }
  return links;
}

// Which sector a map point is in, worked out from the maze alone (−1 = solid).
function sectorAt(maze, x, y) {
  const period = STYLE.cell + STYLE.wall;
  const block = (v) => 2 * Math.floor(v / period) + (v % period >= STYLE.wall ? 1 : 0);
  const [i, j] = [block(x), block(y)];
  if (i <= 0 || j <= 0 || i >= 2 * maze.cols || j >= 2 * maze.rows) return -1;
  const [c, r] = [(i - 1) >> 1, (j - 1) >> 1];
  const goal = maze.goal[1] * maze.cols + maze.goal[0];
  const s = r * maze.cols + c;
  const open = (c2, r2) => maze.passages.some((p) => p.join() === [c, r, c2, r2].join());
  if (i & 1 && j & 1) return s;
  if (!(i & 1) && j & 1) return open(c + 1, r) ? (s === goal ? s + 1 : s) : -1;
  if (i & 1 && !(j & 1)) return open(c, r + 1) ? (s === goal ? s + maze.cols : s) : -1;
  return -1;
}

describe('maze generator', () => {
  it('is deterministic per seed', () => {
    expect(generateMaze({ cols: 6, rows: 6, seed: 7 })).toEqual(generateMaze({ cols: 6, rows: 6, seed: 7 }));
    expect(generateMaze({ cols: 6, rows: 6, seed: 7 })).not.toEqual(generateMaze({ cols: 6, rows: 6, seed: 8 }));
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  it('makes a perfect maze whose goal is the farthest dead end', () => {
    for (const seed of [1, 2, 3, 601, 901]) {
      const maze = generateMaze({ cols: 7, rows: 5, seed, start: [3, 2] });
      expect(maze.passages).toHaveLength(7 * 5 - 1);
      const links = neighbours(maze);
      // Breadth-first search from the start reaches every cell.
      const distance = new Map([['3,2', 0]]);
      const queue = ['3,2'];
      while (queue.length) {
        const cell = queue.shift();
        for (const next of links.get(cell) ?? []) {
          if (!distance.has(next)) {
            distance.set(next, distance.get(cell) + 1);
            queue.push(next);
          }
        }
      }
      expect(distance.size).toBe(35);
      const farthest = Math.max(...distance.values());
      expect(distance.get(maze.goal.join())).toBe(farthest);
      expect(links.get(maze.goal.join())).toHaveLength(1);
      expect(maze.route).toHaveLength(farthest + 1);
      expect(maze.route[0]).toEqual([3, 2]);
      expect(maze.route.at(-1)).toEqual(maze.goal);
    }
  });

  it('rejects bad sizes, seeds and starts', () => {
    expect(() => generateMaze({ cols: 1, rows: 5, seed: 1 })).toThrow(/size/);
    expect(() => generateMaze({ cols: 5, rows: 5, seed: -1 })).toThrow(/seed/);
    expect(() => generateMaze({ cols: 5, rows: 5, seed: 1, start: [5, 0] })).toThrow(/start/);
  });
});

describe('maze geometry', () => {
  const maze = generateMaze({ cols: 6, rows: 4, seed: 42 });
  const map = mazeGeometry(maze, STYLE);
  const goal = maze.goal[1] * maze.cols + maze.goal[0];

  it('puts each line between the sectors on its two sides, front on the right', () => {
    for (const line of map.linedefs) {
      const [x1, y1] = map.vertices[line.v1];
      const [x2, y2] = map.vertices[line.v2];
      const [mx, my] = [(x1 + x2) / 2, (y1 + y2) / 2];
      const length = Math.hypot(x2 - x1, y2 - y1);
      const [nx, ny] = [(y2 - y1) / length, -(x2 - x1) / length]; // right-hand normal
      const right = sectorAt(maze, mx + nx, my + ny);
      const left = sectorAt(maze, mx - nx, my - ny);
      expect(map.sidedefs[line.front].sector).toBe(right);
      if (line.back < 0) {
        expect(left).toBe(-1);
        expect(line.flags).toBe(1);
      } else {
        expect(map.sidedefs[line.back].sector).toBe(left);
        expect(line.flags).toBe(4);
        expect(line.special).toBe(right === goal || left === goal ? 52 : 0);
      }
    }
  });

  it('has one exit line, tagged ROIs and the player in the start cell', () => {
    expect(map.linedefs.filter((line) => line.special === 52)).toHaveLength(1);
    expect(map.sectors).toHaveLength(24);
    expect(map.sectors.map((s) => s.tag).filter(Boolean)).toEqual([900, 901]);
    expect(map.sectors[0].tag).toBe(900);
    expect(map.sectors[goal]).toMatchObject({ tag: 901, floorFlat: 'GATE1' });
    const [player] = map.things;
    expect(sectorAt(maze, player.x, player.y)).toBe(0);
  });

  it('writes vanilla map lumps that read back', () => {
    const wad = writeWad('PWAD', mapLumps(3, map));
    const { type, lumps } = readWad(wad);
    expect(type).toBe('PWAD');
    expect(lumps.map((lump) => lump.name)).toEqual([
      'MAP03', 'THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP',
    ]);
    expect(lumps[2].data.length).toBe(14 * map.linedefs.length);
    expect(lumps[3].data.toString('latin1', 20, 28).replace(/\0+$/, '')).toBe(map.sidedefs[0].middle);
    expect(lumps[8].data.readInt16LE(24)).toBe(900);
  });
});
