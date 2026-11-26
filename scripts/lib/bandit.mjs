// The two-door-bandit map: a start room with two doorways in its north wall, each leading
// through a short passage into a room. The engine's bandit mode (engine/web/dg_mode.c) counts a
// choice when the player enters a passage (sector tag 901 = left, 902 = right) and teleports the
// player back to the start (the teleport destination, thing 14, on the player start).
import { gridGeometry } from './grid.mjs';

export const BANDIT_GENERATOR = 'bandit@1';

const TELEPORT_DESTINATION = 14;
export const START_TAG = 900;
export const LEFT_TAG = 901;
export const RIGHT_TAG = 902;

/**
 * Columns: room, door, room, gap between the rooms, room, door, room; rows: start room, door
 * passage, rooms. Sectors: 0 start, 1 left passage, 2 left room, 3 right passage, 4 right room.
 * Both doors are the same, mirrored about the player's line of sight.
 */
export function banditGeometry(style) {
  const {
    width, doorWidth, gap, startDepth, passageDepth, roomDepth, floor, ceiling, doorCeiling,
    light, roomLight, wallTexture, jambTexture, floorFlat, ceilingFlat,
  } = style;
  const side = (width - gap - 2 * doorWidth) / 4;
  if (!(side > 0)) throw new Error('The room is too narrow for the doors and the gap between them.');
  if (!(doorCeiling > floor + 56 && doorCeiling <= ceiling)) throw new Error('The doorway must be at least 57 units high and no higher than the ceiling.');

  const widths = [side, doorWidth, side, gap, side, doorWidth, side];
  const heights = [startDepth, passageDepth, roomDepth];
  const sectorAt = (i, j) => {
    if (j === 0) return 0;
    if (j === 1) return i === 1 ? 1 : i === 5 ? 3 : -1;
    return i <= 2 ? 2 : i >= 4 ? 4 : -1;
  };
  const passage = (sector) => sector === 1 || sector === 3;

  const { vertices, linedefs, sidedefs, xs } = gridGeometry({
    widths,
    heights,
    sectorAt,
    twoSided: () => ({ flags: 4, special: 0, upper: wallTexture }),
    wallTexture: (sector) => (passage(sector) ? jambTexture : wallTexture),
  });

  const sectors = [
    { tag: START_TAG, light },
    { tag: LEFT_TAG, light: roomLight, ceiling: doorCeiling },
    { tag: LEFT_TAG, light: roomLight },
    { tag: RIGHT_TAG, light: roomLight, ceiling: doorCeiling },
    { tag: RIGHT_TAG, light: roomLight },
  ].map((s) => ({ floor, ceiling, floorFlat, ceilingFlat, special: 0, ...s }));

  const player = { x: width / 2, y: Math.min(96, startDepth / 2), angle: 90 };
  const door = (column) => ({ x: xs[column] + widths[column] / 2, y: startDepth, width: doorWidth });
  return {
    things: [
      { x: player.x, y: player.y, angle: 90, type: 1, flags: 7 },
      { x: player.x, y: player.y, angle: 90, type: TELEPORT_DESTINATION, flags: 7 },
    ],
    linedefs,
    sidedefs,
    vertices,
    sectors,
    player,
    doors: { left: door(1), right: door(5) },
  };
}
