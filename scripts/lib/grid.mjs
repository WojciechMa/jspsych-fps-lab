// Doom map geometry from a block grid: rectangles in columns and rows, each block either solid
// or part of a sector. Lines go where neighbouring blocks differ, merged along each grid line.

/**
 * `widths` and `heights` are the block sizes west→east and south→north (+y is north), starting
 * at (0, 0). `sectorAt(i, j)` gives the sector of block column i, row j (−1 = solid).
 * `twoSided(front, back)` gives { flags, special, upper? } of a line between two sectors (flags
 * should include 4, two-sided; `upper`, default '-', is the upper texture of both sides, seen where
 * a ceiling steps down); `wallTexture(sector)` the middle texture of a wall facing it. Returns
 * vertices, linedefs and sidedefs plus the block offsets; sectors and things are the caller's.
 */
export function gridGeometry({ widths, heights, sectorAt, twoSided, wallTexture }) {
  const starts = (sizes) => sizes.reduce((acc, size) => [...acc, acc.at(-1) + size], [0]);
  const xs = starts(widths);
  const ys = starts(heights);
  // Outside the grid is solid, so blocks on its edge get walls there too.
  const blockAt = (i, j) => (i < 0 || j < 0 || i >= widths.length || j >= heights.length ? -1 : sectorAt(i, j));

  const edges = [];
  for (let i = 0; i <= widths.length; i++) {
    let run = null;
    for (let j = 0; j < heights.length; j++) {
      const left = blockAt(i - 1, j);
      const right = blockAt(i, j);
      if (left === right) {
        run = null;
        continue;
      }
      if (run && run.left === left && run.right === right) {
        run.to += heights[j];
      } else {
        run = { vertical: true, at: xs[i], from: ys[j], to: ys[j] + heights[j], left, right };
        edges.push(run);
      }
    }
  }
  for (let j = 0; j <= heights.length; j++) {
    let run = null;
    for (let i = 0; i < widths.length; i++) {
      // "left" is the block below (south), "right" the one above.
      const left = blockAt(i, j - 1);
      const right = blockAt(i, j);
      if (left === right) {
        run = null;
        continue;
      }
      if (run && run.left === left && run.right === right) {
        run.to += widths[i];
      } else {
        run = { vertical: false, at: ys[j], from: xs[i], to: xs[i] + widths[i], left, right };
        edges.push(run);
      }
    }
  }

  const vertices = [];
  const vertexIndex = new Map();
  const vertex = (x, y) => {
    const key = `${x},${y}`;
    if (!vertexIndex.has(key)) {
      vertexIndex.set(key, vertices.length);
      vertices.push([x, y]);
    }
    return vertexIndex.get(key);
  };
  const sidedefs = [];
  const side = (sector, middle, upper = '-') => {
    sidedefs.push({ upper, lower: '-', middle, sector });
    return sidedefs.length - 1;
  };
  const linedefs = [];
  // A linedef's front side is on the right of v1→v2. Walking from→to, the right-hand block is
  // +x ("right") on vertical edges and −y ("left", the south block) on horizontal ones.
  for (const edge of edges) {
    const start = vertex(...(edge.vertical ? [edge.at, edge.from] : [edge.from, edge.at]));
    const end = vertex(...(edge.vertical ? [edge.at, edge.to] : [edge.to, edge.at]));
    const rightSide = edge.vertical ? edge.right : edge.left;
    const leftSide = edge.vertical ? edge.left : edge.right;
    if (rightSide >= 0 && leftSide >= 0) {
      const { flags, special, upper } = twoSided(rightSide, leftSide);
      linedefs.push({ v1: start, v2: end, flags, special, front: side(rightSide, '-', upper), back: side(leftSide, '-', upper) });
    } else {
      const sector = rightSide >= 0 ? rightSide : leftSide;
      linedefs.push({
        v1: rightSide >= 0 ? start : end,
        v2: rightSide >= 0 ? end : start,
        flags: 1, // impassable
        special: 0,
        front: side(sector, wallTexture(sector)),
        back: -1,
      });
    }
  }
  return { vertices, linedefs, sidedefs, xs, ys };
}
