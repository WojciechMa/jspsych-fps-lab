import { describe, expect, it } from 'vitest';
import { decodePatch, encodePatch, FACE_SIZE, faceLayout, faceLumps, faceMask, paletteMatcher, painTint } from './face.mjs';

// Greyscale ramp plus pure red, green and blue in the first slots.
const palette = Buffer.alloc(768);
for (let i = 0; i < 256; i++) palette.fill(i, i * 3, i * 3 + 3);
palette.set([255, 0, 0, 0, 255, 0, 0, 0, 255], 0);

const solid = (r, g, b) => {
  const rgb = new Uint8Array(FACE_SIZE.width * FACE_SIZE.height * 3);
  for (let i = 0; i < rgb.length; i += 3) rgb.set([r, g, b], i);
  return rgb;
};

describe('status-bar faces', () => {
  it('lays out the 42 patches ST_loadGraphics loads', () => {
    const lumps = faceLayout(3).map((entry) => entry.lump);
    expect(lumps).toHaveLength(42);
    expect(new Set(lumps).size).toBe(42);
    expect(lumps.slice(0, 8)).toEqual(['STFST00', 'STFST01', 'STFST02', 'STFTR00', 'STFTL00', 'STFOUCH0', 'STFEVL0', 'STFKILL0']);
    expect(lumps.slice(-2)).toEqual(['STFGOD0', 'STFDEAD0']);
    expect(faceLayout(2).filter((e) => e.photo === 'straight').map((e) => e.index).slice(0, 3)).toEqual([0, 1, 0]);
  });

  it('round-trips patches with transparent columns and gaps', () => {
    const size = { width: 3, height: 4, left: -5, top: -2 };
    const pixels = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const mask = Uint8Array.from([1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
    const patch = decodePatch(encodePatch(size, pixels, mask));
    expect(patch).toMatchObject({ width: 3, height: 4, left: -5, top: -2 });
    expect([...patch.pixels]).toEqual([1, -1, 3, -1, -1, 6, 7, -1, 9, 10, -1, 12]);
  });

  it('matches palette colours and masks an oval', () => {
    const match = paletteMatcher(palette);
    expect(match(250, 10, 10)).toBe(0);
    expect(match(0, 0, 250)).toBe(2);
    expect(match(100, 100, 100)).toBe(100);
    const mask = faceMask(24, 29, 'oval');
    expect(mask[0]).toBe(0);
    expect(mask[14 * 24 + 12]).toBe(1);
    expect(faceMask(24, 29, 'none').every((v) => v === 1)).toBe(true);
  });

  it('builds all patches from one photo, with pain tints and a dead fallback', () => {
    const lumps = new Map(faceLumps({ straight: [solid(200, 200, 200)] }, palette));
    expect(lumps.size).toBe(42);
    const centre = (name) => {
      const patch = decodePatch(lumps.get(name));
      return patch.pixels[14 * patch.width + 12];
    };
    expect(decodePatch(lumps.get('STFST00'))).toMatchObject({ width: 24, height: 29, left: -5, top: -2 });
    expect(decodePatch(lumps.get('STFST00')).pixels[0]).toBe(-1);
    expect(centre('STFST00')).toBe(200);
    expect(centre('STFKILL0')).toBe(200);
    expect(centre('STFGOD0')).toBe(200);
    expect(lumps.get('STFST40').equals(lumps.get('STFST00'))).toBe(false);
    expect(lumps.get('STFDEAD0').equals(lumps.get('STFST40'))).toBe(false);
    const [r, g] = painTint(solid(200, 200, 200), 4);
    expect(r).toBeGreaterThan(g);
  });

  it('uses the given photos and can skip the tint and mask', () => {
    const lumps = new Map(
      faceLumps({ straight: [solid(50, 50, 50), solid(60, 60, 60)], ouch: solid(70, 70, 70) }, palette, { mask: 'none', pain: 'none' }),
    );
    const first = (name) => decodePatch(lumps.get(name)).pixels[0];
    expect([first('STFST00'), first('STFST01'), first('STFST02'), first('STFOUCH3'), first('STFST40')]).toEqual([50, 60, 50, 70, 50]);
    expect(() => faceLumps({ straight: [] }, palette)).toThrow(/1 to 3/);
    expect(() => faceLumps({ straight: [new Uint8Array(3)] }, palette)).toThrow(/24×29/);
  });
});
