import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readZip } from './zip.mjs';

// One local header + central entry per file; method 8 = deflate, 0 = stored.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, method } of files) {
    const body = method === 8 ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('ZIP reading', () => {
  const text = Buffer.from('freedoom '.repeat(100));
  const archive = zip([
    { name: 'a/stored.txt', data: Buffer.from('plain'), method: 0 },
    { name: 'a/deflated.txt', data: text, method: 8 },
  ]);

  it('lists and reads stored and deflated entries', () => {
    const entries = readZip(archive);
    expect(entries.map((e) => e.name)).toEqual(['a/stored.txt', 'a/deflated.txt']);
    expect(entries[0].read().toString()).toBe('plain');
    expect(entries[1].read().equals(text)).toBe(true);
  });

  it('rejects corrupt entries and non-ZIP data', () => {
    const broken = Buffer.from(archive);
    broken[30 + 'a/stored.txt'.length] ^= 1;
    expect(() => readZip(broken)[0].read()).toThrow(/corrupt/);
    expect(() => readZip(Buffer.from('<html>login</html>'.repeat(3)))).toThrow(/Not a ZIP/);
  });
});
