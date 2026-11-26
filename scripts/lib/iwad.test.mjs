import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { engineTables, parseTextures, trimIwad, wadResources, writeTextures } from './iwad.mjs';
import { mapLumps } from './wad.mjs';

const header = Buffer.alloc(12);
const texture = (name, ...patches) => ({ name, header, patches: patches.map((patch) => ({ x: 0, y: 0, patch, rest: Buffer.alloc(4) })) });

function map(slot, wall, floor) {
  return mapLumps(slot, {
    things: [],
    linedefs: [],
    vertices: [],
    sidedefs: [{ upper: '-', lower: '-', middle: wall, sector: 0 }],
    sectors: [{ floor: 0, ceiling: 128, floorFlat: floor, ceilingFlat: 'F_SKY1', light: 160, special: 0, tag: 0 }],
  });
}

// A tiny IWAD: two maps, one animation cycle (ANIM1..ANIM2), one switch pair and the skies.
function iwad() {
  const { texture1, pnames } = writeTextures([
    texture('AASHITTY', 'P0'),
    texture('WALL1', 'P1'),
    texture('WALL2', 'P2'),
    texture('ANIM1', 'P3'),
    texture('ANIM2', 'P4'),
    texture('SW1', 'P5'),
    texture('SW2', 'P5'),
    texture('SKY1', 'PS'),
    texture('SKY2', 'PS'),
    texture('SKY3', 'PS'),
    texture('UNUSED', 'P6', 'P1'),
  ]);
  const lump = (name) => [name, Buffer.from(name)];
  return [
    lump('PLAYPAL'),
    lump('DEMO1'),
    ...map(1, 'WALL1', 'FLAT1'),
    ...map(2, 'ANIM2', 'FLAT2'),
    ['TEXTURE1', texture1],
    ['PNAMES', pnames],
    lump('D_RUNNIN'),
    lump('DSPISTOL'),
    lump('S_START'), lump('TROOA1'), lump('S_END'),
    lump('P_START'), lump('P1_START'), ...['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'PS'].map(lump), lump('P1_END'), lump('P_END'),
    lump('F_START'), ...['FLAT1', 'FLAT2', 'FLAT3', 'NUKE1', 'NUKE2', 'F_SKY1', 'GRNROCK', 'SLIME16', 'RROCK07', 'RROCK13', 'RROCK14', 'RROCK17', 'RROCK19'].map(lump), lump('F_END'),
  ].map(([name, data]) => ({ name, data }));
}

const tables = {
  switches: ['SW1', 'SW2'],
  anims: [{ texture: true, start: 'ANIM1', end: 'ANIM2' }, { texture: false, start: 'NUKE1', end: 'NUKE2' }],
};
const none = { textures: new Set(), flats: new Set() };
const names = (lumps) => lumps.map(([name]) => name);

describe('IWAD trimming', () => {
  it('keeps MAP01, switches, skies and engine flats; drops other maps, music, demos and unused graphics', () => {
    const { lumps } = trimIwad(iwad(), { maps: [1], pwadResources: none, tables });
    const kept = names(lumps);
    expect(kept).toContain('MAP01');
    expect(kept).not.toContain('MAP02');
    expect(kept).not.toContain('D_RUNNIN');
    expect(kept).not.toContain('DEMO1');
    expect(kept).toEqual(expect.arrayContaining(['PLAYPAL', 'DSPISTOL', 'TROOA1', 'P0', 'P1', 'P5', 'PS', 'FLAT1', 'F_SKY1', 'GRNROCK', 'SLIME16']));
    for (const gone of ['P2', 'P3', 'P4', 'P6', 'FLAT2', 'FLAT3', 'NUKE1', 'NUKE2']) expect(kept).not.toContain(gone);
    const textures = parseTextures(lumps.find(([n]) => n === 'TEXTURE1')[1], lumps.find(([n]) => n === 'PNAMES')[1]);
    expect(textures.map((t) => t.name)).toEqual(['AASHITTY', 'WALL1', 'SW1', 'SW2', 'SKY1', 'SKY2', 'SKY3']);
    expect(textures[2].patches[0].patch).toBe('P5');
  });

  it('keeps whole animation cycles and what map WADs need', () => {
    const pwad = { textures: new Set(['WALL2']), flats: new Set(['NUKE2']) };
    const { lumps } = trimIwad(iwad(), { maps: [1, 2], pwadResources: pwad, tables });
    const kept = names(lumps);
    expect(kept).toEqual(expect.arrayContaining(['MAP02', 'P2', 'P3', 'P4', 'FLAT2', 'NUKE1', 'NUKE2']));
    const textures = parseTextures(lumps.find(([n]) => n === 'TEXTURE1')[1], lumps.find(([n]) => n === 'PNAMES')[1]);
    expect(textures.map((t) => t.name)).toEqual(['AASHITTY', 'WALL1', 'WALL2', 'ANIM1', 'ANIM2', 'SW1', 'SW2', 'SKY1', 'SKY2', 'SKY3']);
  });

  it('rejects missing MAP01, unknown maps and unknown textures', () => {
    expect(() => trimIwad(iwad(), { maps: [2], pwadResources: none, tables })).toThrow(/MAP01/);
    expect(() => trimIwad(iwad(), { maps: [1, 3], pwadResources: none, tables })).toThrow(/no MAP03/);
    expect(() => trimIwad(iwad(), { maps: [1], pwadResources: { textures: new Set(['NOPE']), flats: new Set() }, tables })).toThrow(/NOPE/);
  });

  it('reads what map WADs use', () => {
    const used = wadResources(map(5, 'WALL2', 'FLAT3').map(([name, data]) => ({ name, data })));
    expect([...used.textures]).toEqual(['WALL2']);
    expect([...used.flats].sort()).toEqual(['FLAT3', 'F_SKY1']);
  });

  it("reads the engine's switch and animation tables", () => {
    const { switches, anims } = engineTables(resolve(import.meta.dirname, '../../engine/doomgeneric'));
    expect(switches.slice(0, 2)).toEqual(['SW1BRCOM', 'SW2BRCOM']);
    expect(switches).toContain('SW2SKULL');
    expect(anims).toContainEqual({ texture: false, start: 'NUKAGE1', end: 'NUKAGE3' });
    expect(anims).toContainEqual({ texture: true, start: 'BLODGR1', end: 'BLODGR4' });
  });
});
