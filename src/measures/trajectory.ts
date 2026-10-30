// trajectory: position and view direction per tic, path length, coverage and revisits.
import type { TicState } from '../engine/types';
import type { Measure } from './types';
import { angleDiff, round } from './util';

interface Params {
  decimals: number;
  cellSize: number;
  revisitGapTics: number;
  teleportStep: number;
}

export const trajectory: Measure<Params> = {
  id: 'trajectory',
  version: '1.0.0',
  label: 'Trajectory',
  participantDescription: 'Where you are in the level and which way you are facing, 35 times per second.',
  needs: ['tics'],
  estBytesPerMin: 55_000,
  paramsSchema: {
    type: 'object',
    properties: {
      decimals: {
        type: 'integer',
        default: 2,
        minimum: 0,
        maximum: 4,
        description: 'Decimals kept for x, y (map units) and angle (degrees) in the per-tic columns.',
      },
      cellSize: {
        type: 'number',
        default: 64,
        minimum: 1,
        description: 'Side of the square grid cells (map units) for coverage and revisits. The player is 32 units wide.',
      },
      revisitGapTics: {
        type: 'integer',
        default: 35,
        minimum: 0,
        description: 'Entering a cell counts as a revisit when the player was last in it more than this many tics ago.',
      },
      teleportStep: {
        type: 'number',
        default: 128,
        minimum: 1,
        description: 'A move longer than this in one tic (map units) is a teleport and is left out of the path length.',
      },
    },
    additionalProperties: false,
  },
  create(ctx, params) {
    const x: number[] = [];
    const y: number[] = [];
    const angle: number[] = [];
    // Last tic spent in each visited cell.
    const lastInCell = new Map<string, number>();
    let cell: string | null = null;
    let previous: TicState | null = null;
    let pathLength = 0;
    let turning = 0;
    let teleports = 0;
    let revisits = 0;

    return {
      onTic(tic) {
        x.push(round(tic.x, params.decimals));
        y.push(round(tic.y, params.decimals));
        angle.push(round(tic.angle, params.decimals));
        if (previous) {
          const step = Math.hypot(tic.x - previous.x, tic.y - previous.y);
          if (step > params.teleportStep) teleports++;
          else pathLength += step;
          turning += Math.abs(angleDiff(tic.angle, previous.angle));
        }
        previous = tic;

        const here = `${Math.floor(tic.x / params.cellSize)},${Math.floor(tic.y / params.cellSize)}`;
        if (here !== cell) {
          const last = lastInCell.get(here);
          if (last !== undefined && tic.tic - last > params.revisitGapTics) revisits++;
          cell = here;
        }
        lastInCell.set(here, tic.tic);
      },
      finish(end) {
        const seconds = end.durationTics / ctx.ticRate;
        return {
          summary: {
            path_length: round(pathLength, 1),
            mean_speed: seconds > 0 ? round(pathLength / seconds, 1) : null,
            turning_deg: round(turning, 1),
            coverage_cells: lastInCell.size,
            revisits,
            teleports,
          },
          raw: { x, y, angle },
        };
      },
    };
  },
};
