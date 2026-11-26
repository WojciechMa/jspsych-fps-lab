// Status-bar faces from photos: the 42 STF* patches that ST_loadGraphics (st_stuff.c) loads at boot.

/** Patch size and offsets of Doom's straight faces (STFST00), so the face sits in the same spot. */
export const FACE_SIZE = { width: 24, height: 29, left: -5, top: -2 };
export const PAIN_LEVELS = 5;

/** Photo keys of face.json; all but `straight` fall back to it. */
export const PHOTO_KEYS = ['straight', 'turn_left', 'turn_right', 'ouch', 'grin', 'kill', 'god', 'dead'];

/**
 * Lump name → which photo and pain level it shows. `straight` is a list of 1–3 photos that the
 * engine picks from at random for the idle face (STFSTp0–2).
 */
export function faceLayout(straightCount) {
  const layout = [];
  for (let pain = 0; pain < PAIN_LEVELS; pain++) {
    for (let j = 0; j < 3; j++) layout.push({ lump: `STFST${pain}${j}`, photo: 'straight', index: j % straightCount, pain });
    layout.push({ lump: `STFTR${pain}0`, photo: 'turn_right', pain });
    layout.push({ lump: `STFTL${pain}0`, photo: 'turn_left', pain });
    layout.push({ lump: `STFOUCH${pain}`, photo: 'ouch', pain });
    layout.push({ lump: `STFEVL${pain}`, photo: 'grin', pain });
    layout.push({ lump: `STFKILL${pain}`, photo: 'kill', pain });
  }
  layout.push({ lump: 'STFGOD0', photo: 'god', pain: 0 });
  layout.push({ lump: 'STFDEAD0', photo: 'dead', pain: 0 });
  return layout;
}

/** Reddens and darkens an RGB image (3 bytes per pixel) for pain level 0 (none) to 4. */
export function painTint(rgb, pain) {
  const f = pain / (PAIN_LEVELS - 1);
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    out[i] = Math.round(rgb[i] * (1 - 0.3 * f) + 110 * 0.3 * f);
    out[i + 1] = Math.round(rgb[i + 1] * (1 - 0.6 * f));
    out[i + 2] = Math.round(rgb[i + 2] * (1 - 0.6 * f));
  }
  return out;
}

/** Grey and dark: the dead face when no `dead` photo is given. */
export function deadTint(rgb) {
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const grey = Math.round((0.3 * rgb[i] + 0.59 * rgb[i + 1] + 0.11 * rgb[i + 2]) * 0.55);
    out[i] = Math.min(255, grey + 25);
    out[i + 1] = grey;
    out[i + 2] = grey;
  }
  return out;
}

/** CIELAB (D65) of an sRGB colour. */
function lab(r, g, b) {
  const linear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047);
  const y = f(0.2126 * lr + 0.7152 * lg + 0.0722 * lb);
  const z = f((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Nearest PLAYPAL colour (first palette, 768 bytes) by CIELAB distance. */
export function paletteMatcher(playpal) {
  const colours = Array.from({ length: 256 }, (_, i) => lab(playpal[i * 3], playpal[i * 3 + 1], playpal[i * 3 + 2]));
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best !== undefined) return best;
    const [l, a, bb] = lab(r, g, b);
    let bestDistance = Infinity;
    colours.forEach(([pl, pa, pb], i) => {
      const distance = (l - pl) ** 2 + (a - pa) ** 2 + (bb - pb) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    cache.set(key, best);
    return best;
  };
}

/** Which pixels are drawn: an ellipse filling the frame, or all of them. */
export function faceMask(width, height, shape) {
  const mask = new Uint8Array(width * height).fill(1);
  if (shape === 'none') return mask;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - width / 2) / (width / 2);
      const dy = (y + 0.5 - height / 2) / (height / 2);
      if (dx * dx + dy * dy > 1) mask[y * width + x] = 0;
    }
  }
  return mask;
}

/** Doom patch from palette indices (row-major) and a mask; masked-out pixels are transparent. */
export function encodePatch({ width, height, left, top }, pixels, mask) {
  if (height > 254) throw new Error('Patches taller than 254 pixels need tall-patch posts.');
  const columns = [];
  for (let x = 0; x < width; x++) {
    const bytes = [];
    let y = 0;
    while (y < height) {
      if (!mask[y * width + x]) {
        y++;
        continue;
      }
      const start = y;
      while (y < height && mask[y * width + x]) y++;
      bytes.push(start, y - start, 0);
      for (let row = start; row < y; row++) bytes.push(pixels[row * width + x]);
      bytes.push(0);
    }
    bytes.push(0xff);
    columns.push(Buffer.from(bytes));
  }
  const header = Buffer.alloc(8 + 4 * width);
  header.writeInt16LE(width, 0);
  header.writeInt16LE(height, 2);
  header.writeInt16LE(left, 4);
  header.writeInt16LE(top, 6);
  let offset = header.length;
  columns.forEach((column, x) => {
    header.writeUInt32LE(offset, 8 + 4 * x);
    offset += column.length;
  });
  return Buffer.concat([header, ...columns]);
}

/** Palette indices (row-major, -1 = transparent) and offsets of a patch. */
export function decodePatch(data) {
  const width = data.readInt16LE(0);
  const height = data.readInt16LE(2);
  const pixels = new Int16Array(width * height).fill(-1);
  for (let x = 0; x < width; x++) {
    let o = data.readUInt32LE(8 + 4 * x);
    while (data[o] !== 0xff) {
      const top = data[o];
      const length = data[o + 1];
      for (let i = 0; i < length; i++) pixels[(top + i) * width + x] = data[o + 3 + i];
      o += length + 4;
    }
  }
  return { width, height, left: data.readInt16LE(4), top: data.readInt16LE(6), pixels };
}

/**
 * The face lumps from photos already cropped and scaled to FACE_SIZE (RGB, 3 bytes per pixel).
 * `photos.straight` is a list of 1–3 images; the other keys are optional.
 */
export function faceLumps(photos, playpal, { mask = 'oval', pain = 'tint' } = {}) {
  const { width, height } = FACE_SIZE;
  const straight = photos.straight;
  if (!Array.isArray(straight) || straight.length < 1 || straight.length > 3) {
    throw new Error('photos.straight needs 1 to 3 images.');
  }
  for (const image of [...straight, ...PHOTO_KEYS.slice(1).map((key) => photos[key]).filter(Boolean)]) {
    if (image.length !== width * height * 3) throw new Error(`Face images must be ${width}×${height} RGB.`);
  }
  const match = paletteMatcher(playpal);
  const shape = faceMask(width, height, mask);
  return faceLayout(straight.length).map(({ lump, photo, index, pain: level }) => {
    let rgb = photo === 'straight' ? straight[index] : (photos[photo] ?? straight[0]);
    if (photo === 'dead' && !photos.dead) rgb = deadTint(painTint(straight[0], PAIN_LEVELS - 1));
    else if (pain === 'tint' && level > 0) rgb = painTint(rgb, level);
    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = match(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    return [lump, encodePatch(FACE_SIZE, pixels, shape)];
  });
}
