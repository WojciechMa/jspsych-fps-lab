// The threat-corridor map: a straight corridor running north with alcoves where the engine's
// threat mode (engine/web/dg_mode.c) spawns monsters, at its teleport destinations (thing 14).
// Each spot sits just inside an alcove's mouth: the corridor walls hide anything deeper from a
// player further along, and the threat must be visible from anywhere in the corridor.
import { gridGeometry } from './grid.mjs';

export const CORRIDOR_GENERATOR = 'corridor@1';

const TELEPORT_DESTINATION = 14;
// How far a spot lies inside its alcove, so its monster belongs to the alcove's sector.
const SPOT_INSET = 4;

/**
 * `pairs` pairs of side alcoves face each other along the corridor; one more alcove sits at each
 * end, behind and ahead of the player, who starts near the south end facing north. Spots are in
 * thing order, which is the engine's spot order: behind, ahead, then left-1, right-1, left-2, …
 * counted from the start. Sector 0 is the corridor, sector k + 1 the alcove of spot k.
 */
export function corridorGeometry({ pairs }, style) {
  if (!(Number.isInteger(pairs) && pairs >= 0 && pairs <= 8)) throw new Error(`Corridor pairs ${pairs}: use a whole number 0–8.`);
  const { width, alcoveWidth, alcoveDepth, gap, startLength, floor, ceiling, light, wallTexture, floorFlat, ceilingFlat } = style;
  if (alcoveWidth >= width) throw new Error('The alcoves must be narrower than the corridor.');

  // Columns: left alcoves, corridor (side, middle, side), right alcoves. The end alcoves take the
  // middle column, as wide as the side alcoves.
  const side = (width - alcoveWidth) / 2;
  const widths = [alcoveDepth, side, alcoveWidth, side, alcoveDepth];
  // Rows: end alcove, start area, then a gap and an alcove row per pair, a last gap, end alcove.
  const heights = [alcoveDepth, startLength];
  const pairRows = [];
  for (let k = 0; k < pairs; k++) {
    heights.push(gap, alcoveWidth);
    pairRows.push(heights.length - 1);
  }
  heights.push(gap, alcoveDepth);
  const last = heights.length - 1;

  const spots = [
    { name: 'behind', column: 2, row: 0, angle: 90 },
    { name: 'ahead', column: 2, row: last, angle: 270 },
    ...pairRows.flatMap((row, k) => [
      { name: `left-${k + 1}`, column: 0, row, angle: 0 },
      { name: `right-${k + 1}`, column: 4, row, angle: 180 },
    ]),
  ];
  const alcoveAt = new Map(spots.map((spot, k) => [`${spot.column},${spot.row}`, k + 1]));
  const sectorAt = (i, j) => {
    const alcove = alcoveAt.get(`${i},${j}`);
    if (alcove !== undefined) return alcove;
    return i >= 1 && i <= 3 && j >= 1 && j < last ? 0 : -1;
  };

  const { vertices, linedefs, sidedefs, xs, ys } = gridGeometry({
    widths,
    heights,
    sectorAt,
    twoSided: () => ({ flags: 4, special: 0 }), // two-sided; attacking monsters may step out
    wallTexture: () => wallTexture,
  });

  const sectors = Array.from({ length: spots.length + 1 }, () => ({
    floor, ceiling, floorFlat, ceilingFlat, light, special: 0, tag: 0,
  }));
  const centre = (column, row) => [xs[column] + widths[column] / 2, ys[row] + heights[row] / 2];
  // Mouth of the alcove at a spot: the edge it shares with the corridor, moved SPOT_INSET inside.
  const mouth = (column, row, angle) => {
    const [x, y] = centre(column, row);
    const radians = (angle * Math.PI) / 180;
    const reach = (column === 2 ? heights[row] : widths[column]) / 2 - SPOT_INSET;
    return [x + Math.round(Math.cos(radians)) * reach, y + Math.round(Math.sin(radians)) * reach];
  };
  const spotList = spots.map(({ name, column, row, angle }, k) => {
    const [x, y] = mouth(column, row, angle);
    return { spot: k, name, sector: k + 1, x, y, angle };
  });
  const [px, py] = centre(2, 1);
  const things = [
    { x: px, y: py, angle: 90, type: 1, flags: 7 },
    ...spotList.map(({ x, y, angle }) => ({ x, y, angle, type: TELEPORT_DESTINATION, flags: 7 })),
  ];
  return {
    things,
    linedefs,
    sidedefs,
    vertices,
    sectors,
    spots: spotList,
    player: { x: px, y: py, angle: 90 },
    length: ys.at(-1),
  };
}
