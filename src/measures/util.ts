// Small helpers shared by measures.

/** Signed difference a − b in degrees, wrapped to (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** Direction from (x1, y1) to (x2, y2) in degrees counter-clockwise from east, in [0, 360). */
export function bearing(x1: number, y1: number, x2: number, y2: number): number {
  const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}

/** How far the view must turn to face (x, y); positive = to the left. */
export function viewOffset(view: { x: number; y: number; angle: number }, x: number, y: number): number {
  return angleDiff(bearing(view.x, view.y, x, y), view.angle);
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile, p in [0, 100]. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Rows of objects → one array per field. */
export function toColumns<T extends object>(rows: readonly T[], fields: readonly (keyof T)[]): Record<string, unknown[]> {
  return Object.fromEntries(fields.map((field) => [field, rows.map((row) => row[field])]));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
