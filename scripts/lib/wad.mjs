// Minimal Doom WAD writing and reading (vanilla map lump formats, little-endian).

const name8 = (buffer, offset, name) => {
  if (!/^[A-Z0-9_\-[\]\\]{1,8}$/.test(name)) throw new Error(`Bad lump or texture name "${name}".`);
  buffer.fill(0, offset, offset + 8);
  buffer.write(name, offset, 'latin1');
};

const records = (items, size, write) => {
  const buffer = Buffer.alloc(items.length * size);
  items.forEach((item, i) => write(buffer, i * size, item));
  return buffer;
};

const u16 = (value) => (value < 0 ? 0xffff : value);

/** The lumps of one map in vanilla order; node lumps are empty for the node builder to fill. */
export function mapLumps(slot, map) {
  if (map.vertices.length > 32767 || map.linedefs.length > 32767) throw new Error('Map exceeds vanilla limits.');
  const empty = Buffer.alloc(0);
  return [
    [`MAP${String(slot).padStart(2, '0')}`, empty],
    ['THINGS', records(map.things, 10, (b, o, t) => {
      b.writeInt16LE(t.x, o);
      b.writeInt16LE(t.y, o + 2);
      b.writeInt16LE(t.angle, o + 4);
      b.writeInt16LE(t.type, o + 6);
      b.writeInt16LE(t.flags, o + 8);
    })],
    ['LINEDEFS', records(map.linedefs, 14, (b, o, l) => {
      b.writeUInt16LE(l.v1, o);
      b.writeUInt16LE(l.v2, o + 2);
      b.writeInt16LE(l.flags, o + 4);
      b.writeInt16LE(l.special, o + 6);
      b.writeInt16LE(l.tag ?? 0, o + 8);
      b.writeUInt16LE(u16(l.front), o + 10);
      b.writeUInt16LE(u16(l.back), o + 12);
    })],
    ['SIDEDEFS', records(map.sidedefs, 30, (b, o, s) => {
      b.writeInt16LE(s.xOffset ?? 0, o);
      b.writeInt16LE(s.yOffset ?? 0, o + 2);
      name8(b, o + 4, s.upper);
      name8(b, o + 12, s.lower);
      name8(b, o + 20, s.middle);
      b.writeUInt16LE(s.sector, o + 28);
    })],
    ['VERTEXES', records(map.vertices, 4, (b, o, [x, y]) => {
      b.writeInt16LE(x, o);
      b.writeInt16LE(y, o + 2);
    })],
    ['SEGS', empty],
    ['SSECTORS', empty],
    ['NODES', empty],
    ['SECTORS', records(map.sectors, 26, (b, o, s) => {
      b.writeInt16LE(s.floor, o);
      b.writeInt16LE(s.ceiling, o + 2);
      name8(b, o + 4, s.floorFlat);
      name8(b, o + 12, s.ceilingFlat);
      b.writeInt16LE(s.light, o + 20);
      b.writeInt16LE(s.special, o + 22);
      b.writeInt16LE(s.tag, o + 24);
    })],
    ['REJECT', empty],
    ['BLOCKMAP', empty],
  ];
}

export function writeWad(type, lumps) {
  const header = Buffer.alloc(12);
  const data = Buffer.concat(lumps.map(([, content]) => content));
  const directory = Buffer.alloc(lumps.length * 16);
  let position = 12;
  lumps.forEach(([name, content], i) => {
    directory.writeInt32LE(content.length ? position : 0, i * 16);
    directory.writeInt32LE(content.length, i * 16 + 4);
    name8(directory, i * 16 + 8, name);
    position += content.length;
  });
  header.write(type, 0, 'latin1');
  header.writeInt32LE(lumps.length, 4);
  header.writeInt32LE(12 + data.length, 8);
  return Buffer.concat([header, data, directory]);
}

export function readWad(buffer) {
  const type = buffer.toString('latin1', 0, 4);
  if (type !== 'IWAD' && type !== 'PWAD') throw new Error('Not a WAD file.');
  const count = buffer.readInt32LE(4);
  const directory = buffer.readInt32LE(8);
  const lumps = [];
  for (let i = 0; i < count; i++) {
    const o = directory + i * 16;
    const position = buffer.readInt32LE(o);
    const size = buffer.readInt32LE(o + 4);
    const name = buffer.toString('latin1', o + 8, o + 16).replace(/\0.*$/s, '');
    lumps.push({ name, data: buffer.subarray(position, position + size) });
  }
  return { type, lumps };
}
