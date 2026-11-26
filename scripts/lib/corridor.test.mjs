import { describe, expect, it } from 'vitest';
import { corridorGeometry } from './corridor.mjs';
import { mapLumps, readWad, writeWad } from './wad.mjs';

const STYLE = {
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

// Bounding box of the lines that face a sector.
function bounds(map, sector) {
  const points = map.linedefs
    .filter((line) => map.sidedefs[line.front].sector === sector || (line.back >= 0 && map.sidedefs[line.back].sector === sector))
    .flatMap((line) => [map.vertices[line.v1], map.vertices[line.v2]]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('corridor geometry', () => {
  const map = corridorGeometry({ pairs: 2 }, STYLE);

  it('has an alcove per spot, in the engine\'s spot order', () => {
    expect(map.spots.map((s) => s.name)).toEqual(['behind', 'ahead', 'left-1', 'right-1', 'left-2', 'right-2']);
    expect(map.sectors).toHaveLength(7);
    expect(map.things[0]).toMatchObject({ type: 1, angle: 90 });
    expect(map.things.slice(1).map((t) => t.type)).toEqual(Array(6).fill(14));
    map.spots.forEach((spot, k) => {
      expect(spot).toMatchObject({ spot: k, sector: k + 1 });
      expect(map.things[k + 1]).toMatchObject({ x: spot.x, y: spot.y });
      const box = bounds(map, spot.sector);
      expect(spot.x > box.minX && spot.x < box.maxX && spot.y > box.minY && spot.y < box.maxY).toBe(true);
      expect(box.maxX - box.minX).toBe(spot.name.startsWith('left') || spot.name.startsWith('right') ? 96 : 128);
    });
    expect(map.spots[0].y).toBeLessThan(map.player.y);
    expect(map.spots[1].y).toBeGreaterThan(map.player.y);
    expect(map.length).toBe(96 + 256 + 2 * (192 + 128) + 192 + 96);
  });

  it('opens each alcove onto the corridor with one two-sided line, spot just inside it', () => {
    const twoSided = map.linedefs.filter((line) => line.back >= 0);
    expect(twoSided).toHaveLength(6);
    for (const line of twoSided) {
      expect(line.flags).toBe(4);
      const sides = [map.sidedefs[line.front].sector, map.sidedefs[line.back].sector];
      expect(sides).toContain(0);
      const spot = map.spots.find((s) => s.sector === Math.max(...sides));
      const [[x1, y1], [x2, y2]] = [map.vertices[line.v1], map.vertices[line.v2]];
      const gap = x1 === x2 ? Math.abs(spot.x - x1) : Math.abs(spot.y - y1);
      expect(gap).toBe(4);
      expect(x1 === x2 ? spot.y > Math.min(y1, y2) && spot.y < Math.max(y1, y2) : spot.x > Math.min(x1, x2) && spot.x < Math.max(x1, x2)).toBe(true);
    }
    for (const line of map.linedefs.filter((l) => l.back < 0)) {
      expect(line.flags).toBe(1);
      expect(map.sidedefs[line.front].middle).toBe('GRAY1');
    }
    const box = bounds(map, 0);
    expect(map.player.x > box.minX && map.player.x < box.maxX && map.player.y > box.minY && map.player.y < box.maxY).toBe(true);
  });

  it('encloses every sector, including alcoves on the map edge', () => {
    map.sectors.forEach((_, sector) => {
      // A closed boundary meets each of its vertices an even number of times.
      const degree = new Map();
      for (const line of map.linedefs) {
        const sides = [line.front, line.back].filter((s) => s >= 0).map((s) => map.sidedefs[s].sector);
        if (!sides.includes(sector)) continue;
        for (const v of [line.v1, line.v2]) degree.set(v, (degree.get(v) ?? 0) + 1);
      }
      expect([...degree.values()].every((d) => d % 2 === 0), `sector ${sector}`).toBe(true);
    });
  });

  it('writes map lumps and rejects bad sizes', () => {
    const { lumps } = readWad(writeWad('PWAD', mapLumps(10, map)));
    expect(lumps[0].name).toBe('MAP10');
    expect(lumps[1].data.length).toBe(10 * map.things.length);
    expect(corridorGeometry({ pairs: 0 }, STYLE).spots).toHaveLength(2);
    expect(() => corridorGeometry({ pairs: 9 }, STYLE)).toThrow(/pairs/);
    expect(() => corridorGeometry({ pairs: 1 }, { ...STYLE, alcoveWidth: 256 })).toThrow(/narrower/);
  });
});
