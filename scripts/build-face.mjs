// Builds a status-bar face PWAD from photos: npm run build:face -- <face-id>. Reads
// faces/<id>/face.json and its photos, writes public/wads/face-<id>.wad, faces/<id>/preview.png
// and faces/<id>/face-<id>.wad.gz.b64 (the value of the JATOS workflow's FACE_<ID> secret).
// faces/ and public/wads/face-* are git-ignored, and the Pages build drops face WADs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { decodePatch, FACE_SIZE, faceLumps, PHOTO_KEYS } from './lib/face.mjs';
import { readWad, writeWad } from './lib/wad.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wadDir = resolve(root, 'public/wads');
const SECRET_LIMIT = 48 * 1024;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const id = process.argv[2];
if (!id || !/^[a-z0-9-]+$/.test(id) || id === 'freedoom') {
  fail('Usage: npm run build:face -- <face-id> (a folder in faces/; a-z, 0-9 and -; not "freedoom")');
}
const faceDir = resolve(root, 'faces', id);
const configPath = resolve(faceDir, 'face.json');
if (!existsSync(configPath)) fail(`faces/${id}/face.json is missing; see "Status-bar faces" in the README.`);
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const known = ['consent', 'photos', 'mask', 'pain'];
const unknown = Object.keys(config).filter((key) => !known.includes(key));
if (unknown.length) fail(`face.json: unknown field(s) ${unknown.join(', ')} (known: ${known.join(', ')}).`);
if (typeof config.consent !== 'string' || !config.consent.trim()) {
  fail('face.json: "consent" must say where the written consent of the person shown is kept.');
}
if (!['oval', 'none', undefined].includes(config.mask)) fail('face.json: "mask" is "oval" (default) or "none".');
if (!['tint', 'none', undefined].includes(config.pain)) fail('face.json: "pain" is "tint" (default) or "none".');
const photos = config.photos ?? {};
const unknownPhotos = Object.keys(photos).filter((key) => !PHOTO_KEYS.includes(key));
if (unknownPhotos.length) fail(`face.json: unknown photo(s) ${unknownPhotos.join(', ')} (known: ${PHOTO_KEYS.join(', ')}).`);
if (!photos.straight) fail('face.json: photos.straight is needed.');

/** A photo cropped (EXIF rotation applied first) and scaled to the face size, as RGB. */
async function loadPhoto(spec, key) {
  const { file, crop } = typeof spec === 'string' ? { file: spec } : (spec ?? {});
  const path = resolve(faceDir, String(file));
  if (typeof file !== 'string' || !path.startsWith(faceDir + sep)) fail(`face.json: photos.${key} must name a file in faces/${id}/.`);
  if (!existsSync(path)) fail(`faces/${id}/${file} is missing.`);
  let image = sharp(readFileSync(path)).rotate();
  if (crop !== undefined) {
    if (!Array.isArray(crop) || crop.length !== 4 || !crop.every((n) => Number.isInteger(n) && n >= 0)) {
      fail(`face.json: photos.${key}.crop is [left, top, width, height] in pixels of the (upright) photo.`);
    }
    const [left, top, width, height] = crop;
    image = sharp(await image.toBuffer()).extract({ left, top, width, height });
  }
  const { data, info } = await image
    .flatten({ background: '#808080' })
    .resize(FACE_SIZE.width, FACE_SIZE.height, { fit: 'cover', kernel: 'lanczos3' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) fail(`faces/${id}/${file}: expected RGB after conversion, got ${info.channels} channels.`);
  return new Uint8Array(data);
}

const iwad = JSON.parse(readFileSync(resolve(root, 'src/paradigms/iwad.json'), 'utf8'));
let freedoom;
try {
  freedoom = readFileSync(resolve(wadDir, iwad.source.name));
} catch {
  fail(`public/wads/${iwad.source.name} is missing (its palette is needed): run npm run fetch:freedoom.`);
}
if (createHash('sha256').update(freedoom).digest('hex') !== iwad.source.sha256) {
  fail(`public/wads/${iwad.source.name} is not Freedoom ${iwad.source.release}: run npm run fetch:freedoom.`);
}
const playpal = readWad(freedoom).lumps.find((lump) => lump.name === 'PLAYPAL').data.subarray(0, 768);

const straightSpecs = Array.isArray(photos.straight) ? photos.straight : [photos.straight];
const images = { straight: await Promise.all(straightSpecs.map((spec, i) => loadPhoto(spec, `straight[${i}]`))) };
for (const key of PHOTO_KEYS.slice(1)) {
  if (photos[key] !== undefined) images[key] = await loadPhoto(photos[key], key);
}
let lumps;
try {
  lumps = faceLumps(images, playpal, { mask: config.mask, pain: config.pain });
} catch (error) {
  fail(`face.json: ${error.message}`);
}
const wad = writeWad('PWAD', lumps);
const wadPath = resolve(wadDir, `face-${id}.wad`);
writeFileSync(wadPath, wad);

// Preview, 4× scale: one row per pain level (3 straight, turn right, turn left, ouch, grin, kill), then god and dead.
const cell = { width: FACE_SIZE.width + 2, height: FACE_SIZE.height + 2 };
const columns = 8;
const rows = Math.ceil(lumps.length / columns);
const sheet = Buffer.alloc(columns * cell.width * rows * cell.height * 3, 48);
lumps.forEach(([, data], n) => {
  const patch = decodePatch(data);
  const x0 = (n % columns) * cell.width + 1;
  const y0 = Math.floor(n / columns) * cell.height + 1;
  for (let y = 0; y < patch.height; y++) {
    for (let x = 0; x < patch.width; x++) {
      const index = patch.pixels[y * patch.width + x];
      const o = ((y0 + y) * columns * cell.width + x0 + x) * 3;
      if (index >= 0) playpal.copy(sheet, o, index * 3, index * 3 + 3);
      else sheet.fill(96, o, o + 3);
    }
  }
});
const previewPath = resolve(faceDir, 'preview.png');
await sharp(sheet, { raw: { width: columns * cell.width, height: rows * cell.height, channels: 3 } })
  .resize(columns * cell.width * 4, rows * cell.height * 4, { kernel: 'nearest' })
  .png()
  .toFile(previewPath);

const secret = gzipSync(wad, { level: 9 }).toString('base64');
const secretPath = resolve(faceDir, `face-${id}.wad.gz.b64`);
writeFileSync(secretPath, secret);
const secretName = `FACE_${id.toUpperCase().replaceAll('-', '_')}`;
const show = (path) => relative(root, path).split(sep).join('/');

console.log(`Wrote ${show(wadPath)} (${lumps.length} patches, ${(wad.length / 1024).toFixed(1)} KB, SHA-256 ${createHash('sha256').update(wad).digest('hex')}).`);
console.log(`Check ${show(previewPath)}: pain levels 0–4 by row (straight ×3, turn right, turn left, ouch, grin, kill), then god and dead.`);
console.log(`For the JATOS workflow, add the environment secret ${secretName} (GitHub: Settings > Environments) with the`);
console.log(`contents of ${show(secretPath)} (${(secret.length / 1024).toFixed(1)} KB of GitHub's 48 KB).`);
if (secret.length > SECRET_LIMIT) fail('That is over the limit: import the JZIP by hand instead (npm run build:jatos -- <study-id>).');
