// Minimal ZIP reading: stored and deflated entries, no ZIP64 (enough for release archives).
import { crc32, inflateRawSync } from 'node:zlib';

/** The archive's file entries; `read()` returns the uncompressed bytes, checked against the CRC. */
export function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a ZIP archive.');
  const count = buffer.readUInt16LE(end + 10);
  let o = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(o) !== 0x02014b50) throw new Error('Bad ZIP central directory.');
    const method = buffer.readUInt16LE(o + 10);
    const crc = buffer.readUInt32LE(o + 16);
    const compressed = buffer.readUInt32LE(o + 20);
    const size = buffer.readUInt32LE(o + 24);
    const nameLength = buffer.readUInt16LE(o + 28);
    const local = buffer.readUInt32LE(o + 42);
    const name = buffer.toString('utf8', o + 46, o + 46 + nameLength);
    o += 46 + nameLength + buffer.readUInt16LE(o + 30) + buffer.readUInt16LE(o + 32);
    entries.push({
      name,
      size,
      read() {
        if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`Bad ZIP entry ${name}.`);
        const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
        const raw = buffer.subarray(start, start + compressed);
        if (method !== 0 && method !== 8) throw new Error(`${name}: unsupported ZIP compression ${method}.`);
        const data = method === 8 ? inflateRawSync(raw) : raw;
        if (data.length !== size || crc32(data) !== crc) throw new Error(`${name}: corrupt ZIP entry.`);
        return data;
      },
    });
  }
  return entries;
}
