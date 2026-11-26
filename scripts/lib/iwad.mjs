// Trims a Doom II IWAD to the maps a project uses: drops the other maps, music, demos and every
// wall texture, patch and flat that no kept map (IWAD or PWAD) needs. Keeps what the engine looks
// up by name: switch textures, animation cycles, the skies and the flats in ENGINE_FLATS.
import { readFileSync } from 'node:fs';

const MAP_LUMPS = new Set(['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP']);
// Doom II picks the sky by map number (G_DoLoadLevel), so every slot needs one of these.
const SKIES = ['SKY1', 'SKY2', 'SKY3'];
// Flats the engine loads by name: the sky marker, the Doom II view border (r_draw.c) and the
// finale text screens (f_finale.c, after MAP06/11/15/20/30/31; trials end before them).
const ENGINE_FLATS = ['F_SKY1', 'GRNROCK', 'SLIME16', 'RROCK14', 'RROCK07', 'RROCK17', 'RROCK13', 'RROCK19'];

const cString = (buffer, offset, length = 8) => buffer.toString('latin1', offset, offset + length).replace(/\0.*$/s, '').toUpperCase();

/** Switch texture pairs and animation cycles, read from the engine source so they stay in sync. */
export function engineTables(engineDir) {
  const switchSource = readFileSync(`${engineDir}/p_switch.c`, 'latin1');
  const switches = [...switchSource.matchAll(/\{\s*"(\w+)",\s*"(\w+)",\s*[1-3]\s*\}/g)].flatMap((m) => [m[1], m[2]]);
  const specSource = readFileSync(`${engineDir}/p_spec.c`, 'latin1');
  const anims = [...specSource.matchAll(/\{\s*(true|false),\s*"(\w+)",\s*"(\w+)",\s*\d+\s*\}/g)]
    .map((m) => ({ texture: m[1] === 'true', end: m[2], start: m[3] }));
  if (switches.length < 2 || anims.length < 2) throw new Error('Could not read the switch and animation tables from the engine source.');
  return { switches, anims };
}

/** Lump ranges: maps (MAPxx and its lumps) and the P_/F_/S_ marker sections. */
function classify(lumps) {
  const kinds = [];
  let section = null;
  let map = null;
  for (const { name } of lumps) {
    const marker = /^(P|F|S|PP|FF|SS|P[1-3]|F[1-3])_(START|END)$/.exec(name);
    if (marker) {
      // P1_START etc. nest inside P_START; only the outer markers open and close a section.
      if (!/\d/.test(marker[1])) section = marker[2] === 'START' ? marker[1][0] : null;
      kinds.push({ kind: 'marker' });
      continue;
    }
    if (/^MAP\d\d$/.test(name)) map = name;
    else if (!(map && MAP_LUMPS.has(name))) map = null;
    kinds.push(map ? { kind: 'map', map } : { kind: section ?? 'lump' });
  }
  return kinds;
}

export function parseTextures(textureLump, pnamesLump) {
  const patchNames = Array.from({ length: pnamesLump.readInt32LE(0) }, (_, i) => cString(pnamesLump, 4 + i * 8));
  const count = textureLump.readInt32LE(0);
  return Array.from({ length: count }, (_, i) => {
    const o = textureLump.readInt32LE(4 + i * 4);
    const patchCount = textureLump.readInt16LE(o + 20);
    return {
      name: cString(textureLump, o),
      header: textureLump.subarray(o + 8, o + 20), // masked, width, height, columndirectory
      patches: Array.from({ length: patchCount }, (_, k) => {
        const p = o + 22 + k * 10;
        return { x: textureLump.readInt16LE(p), y: textureLump.readInt16LE(p + 2), patch: patchNames[textureLump.readInt16LE(p + 4)], rest: textureLump.subarray(p + 6, p + 10) };
      }),
    };
  });
}

export function writeTextures(textures) {
  const patchNames = [...new Set(textures.flatMap((t) => t.patches.map((p) => p.patch)))];
  const index = new Map(patchNames.map((name, i) => [name, i]));
  const pnames = Buffer.alloc(4 + patchNames.length * 8);
  pnames.writeInt32LE(patchNames.length, 0);
  patchNames.forEach((name, i) => pnames.write(name, 4 + i * 8, 'latin1'));

  const sizes = textures.map((t) => 22 + t.patches.length * 10);
  const texture1 = Buffer.alloc(4 + textures.length * 4 + sizes.reduce((a, b) => a + b, 0));
  texture1.writeInt32LE(textures.length, 0);
  let o = 4 + textures.length * 4;
  textures.forEach((t, i) => {
    texture1.writeInt32LE(o, 4 + i * 4);
    texture1.write(t.name, o, 'latin1');
    t.header.copy(texture1, o + 8);
    texture1.writeInt16LE(t.patches.length, o + 20);
    t.patches.forEach((p, k) => {
      const q = o + 22 + k * 10;
      texture1.writeInt16LE(p.x, q);
      texture1.writeInt16LE(p.y, q + 2);
      texture1.writeInt16LE(index.get(p.patch), q + 4);
      p.rest.copy(texture1, q + 6);
    });
    o += sizes[i];
  });
  return { texture1, pnames, patchNames };
}

/** Wall textures and flats a map's SIDEDEFS and SECTORS name. */
export function mapResources(sidedefs, sectors) {
  const textures = new Set();
  const flats = new Set();
  for (let o = 0; o + 30 <= sidedefs.length; o += 30) {
    for (const at of [4, 12, 20]) textures.add(cString(sidedefs, o + at));
  }
  for (let o = 0; o + 26 <= sectors.length; o += 26) {
    flats.add(cString(sectors, o + 4));
    flats.add(cString(sectors, o + 12));
  }
  textures.delete('-');
  textures.delete('');
  return { textures, flats };
}

/** The textures and flats used by every map of a WAD's lumps. */
export function wadResources(lumps) {
  const textures = new Set();
  const flats = new Set();
  const kinds = classify(lumps);
  lumps.forEach((lump, i) => {
    if (kinds[i].kind !== 'map' || lump.name !== 'SIDEDEFS') return;
    const sectors = lumps.slice(i).find((l) => l.name === 'SECTORS');
    const used = mapResources(lump.data, sectors.data);
    used.textures.forEach((t) => textures.add(t));
    used.flats.forEach((f) => flats.add(f));
  });
  return { textures, flats };
}

/**
 * `lumps` of the full IWAD → lumps of the trimmed one. `maps`: MAPxx numbers to keep (MAP01 is
 * needed: the engine boots into it and identifies Doom II by it); `pwadResources`: textures and
 * flats other WADs' maps need from the IWAD.
 */
export function trimIwad(lumps, { maps, pwadResources, tables }) {
  if (!maps.includes(1)) throw new Error('Keep MAP01: the engine boots into it.');
  const keepMaps = new Set(maps.map((n) => `MAP${String(n).padStart(2, '0')}`));
  const kinds = classify(lumps);
  const byName = (name) => lumps.find((l) => l.name === name);
  if (byName('TEXTURE2')) throw new Error('TEXTURE2 is not supported.');
  const textures = parseTextures(byName('TEXTURE1').data, byName('PNAMES').data);
  const known = new Set(textures.map((t) => t.name));

  const needed = new Set([...SKIES, ...tables.switches, ...pwadResources.textures]);
  const neededFlats = new Set([...ENGINE_FLATS, ...pwadResources.flats]);
  const missingMaps = [...keepMaps].filter((m) => !lumps.some((l) => l.name === m));
  if (missingMaps.length) throw new Error(`The IWAD has no ${missingMaps.join(', ')}.`);
  lumps.forEach((lump, i) => {
    if (kinds[i].kind === 'map' && keepMaps.has(kinds[i].map) && lump.name === 'SIDEDEFS') {
      const sectors = lumps.slice(i).find((l) => l.name === 'SECTORS');
      const used = mapResources(lump.data, sectors.data);
      used.textures.forEach((t) => needed.add(t));
      used.flats.forEach((f) => neededFlats.add(f));
    }
  });
  const unknown = [...needed].filter((t) => !known.has(t));
  if (unknown.length) throw new Error(`Textures not in the IWAD: ${unknown.join(', ')}.`);
  const flats = lumps.filter((_, i) => kinds[i].kind === 'F').map((l) => l.name);
  const unknownFlats = [...neededFlats].filter((f) => !flats.includes(f));
  if (unknownFlats.length) throw new Error(`Flats not in the IWAD: ${unknownFlats.join(', ')}.`);

  // Animations step through texture (flat) numbers, so a cycle is kept whole or, with its first
  // frame, dropped: the engine skips cycles whose first frame is missing.
  const order = new Map(textures.map((t, i) => [t.name, i]));
  for (const anim of tables.anims.filter((a) => a.texture && order.has(a.start))) {
    const range = textures.slice(order.get(anim.start), order.get(anim.end) + 1).map((t) => t.name);
    if (range.some((t) => needed.has(t))) range.forEach((t) => needed.add(t));
  }
  for (const anim of tables.anims.filter((a) => !a.texture && flats.includes(a.start))) {
    const range = flats.slice(flats.indexOf(anim.start), flats.indexOf(anim.end) + 1);
    if (range.some((f) => neededFlats.has(f))) range.forEach((f) => neededFlats.add(f));
  }
  // Texture 0 stands for "no texture" and is never drawn; it stays first.
  const kept = textures.filter((t, i) => i === 0 || needed.has(t.name));
  const { texture1, pnames, patchNames } = writeTextures(kept);
  const keepPatches = new Set(patchNames);

  const out = [];
  lumps.forEach((lump, i) => {
    const { kind, map } = kinds[i];
    if (kind === 'map' && !keepMaps.has(map)) return;
    if (kind === 'P' && !keepPatches.has(lump.name)) return;
    if (kind === 'F' && !neededFlats.has(lump.name)) return;
    if (kind === 'lump' && (/^D_/.test(lump.name) || /^DEMO\d$/.test(lump.name))) return;
    if (lump.name === 'TEXTURE1') out.push(['TEXTURE1', texture1]);
    else if (lump.name === 'PNAMES') out.push(['PNAMES', pnames]);
    else out.push([lump.name, lump.data]);
  });
  const missingPatches = patchNames.filter((p) => !lumps.some((l) => l.name === p));
  if (missingPatches.length) throw new Error(`Patches not in the IWAD: ${missingPatches.join(', ')}.`);
  return { lumps: out, textures: kept.length, patches: patchNames.length, flats: neededFlats.size };
}
