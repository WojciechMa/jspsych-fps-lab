import { describe, expect, it } from 'vitest';
import { banditGeometry } from './bandit.mjs';
import { mapLumps, readWad, writeWad } from './wad.mjs';

const STYLE = {
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

describe('bandit geometry', () => {
  const map = banditGeometry(STYLE);

  it('has a tagged start, two passages and two rooms', () => {
    expect(map.sectors.map((s) => s.tag)).toEqual([900, 901, 901, 902, 902]);
    expect(map.sectors.map((s) => s.ceiling)).toEqual([128, 104, 128, 104, 128]);
    expect(map.things).toEqual([
      { x: 320, y: 96, angle: 90, type: 1, flags: 7 },
      { x: 320, y: 96, angle: 90, type: 14, flags: 7 },
    ]);
    expect(map.doors).toEqual({ left: { x: 128, y: 384, width: 128 }, right: { x: 512, y: 384, width: 128 } });
  });

  it('places the doors symmetrically about the player and within view', () => {
    const angle = (door) => (Math.atan2(door.y - map.player.y, door.x - map.player.x) * 180) / Math.PI - 90;
    expect(angle(map.doors.left)).toBeCloseTo(-angle(map.doors.right));
    expect(Math.abs(angle(map.doors.left))).toBeLessThan(40);
  });

  it('connects start → passage → room with two-sided lines that carry a lintel', () => {
    const pairs = map.linedefs
      .filter((line) => line.back >= 0)
      .map((line) => {
        expect(line.flags).toBe(4);
        expect(map.sidedefs[line.front].upper).toBe('GRAY1');
        return [map.sidedefs[line.front].sector, map.sidedefs[line.back].sector].sort().join('-');
      });
    expect(pairs.sort()).toEqual(['0-1', '0-3', '1-2', '3-4']);
    for (const line of map.linedefs.filter((l) => l.back < 0)) {
      const { sector, middle } = map.sidedefs[line.front];
      expect(middle).toBe(sector === 1 || sector === 3 ? 'DOORTRAK' : 'GRAY1');
    }
  });

  it('encloses every sector', () => {
    map.sectors.forEach((_, sector) => {
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
    const { lumps } = readWad(writeWad('PWAD', mapLumps(12, map)));
    expect(lumps[0].name).toBe('MAP12');
    expect(() => banditGeometry({ ...STYLE, width: 384 })).toThrow(/too narrow/);
    expect(() => banditGeometry({ ...STYLE, doorCeiling: 40 })).toThrow(/57 units/);
  });
});
