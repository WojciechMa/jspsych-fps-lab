// aiming: the player's shots, hits, accuracy, and angular error to the nearest visible monster.
import type { TicState, VisibleMonster } from '../engine/types';
import type { Measure } from './types';
import { distance, median, round, toColumns, viewOffset } from './util';

interface Params {
  minPixels: number;
  targetMaxOffsetDeg: number;
}

/** One trigger pull: all bullets or pellets fired in one tic, or one missile. */
interface Discharge {
  tic: number;
  weapon: number | null;
  pellets: number;
  /** Monsters hit by its bullets, or damaged by its missile. */
  hits: number;
  target: number | null;
  /** Angle from the view direction to the target; positive = target is to the left. */
  error_deg: number | null;
  target_distance: number | null;
  candidates: VisibleMonster[];
}

const COLUMNS = ['tic', 'weapon', 'pellets', 'hits', 'target', 'error_deg', 'target_distance'] as const;

export const aiming: Measure<Params> = {
  id: 'aiming',
  version: '1.0.0',
  label: 'Aiming',
  participantDescription:
    'Your shots: when you fire, with which weapon, how far your aim is from the nearest visible monster, and whether you hit.',
  needs: ['tics', 'frames', 'events'],
  estBytesPerMin: 5_000,
  paramsSchema: {
    type: 'object',
    properties: {
      minPixels: {
        type: 'integer',
        default: 20,
        minimum: 1,
        description: 'Monsters with fewer drawn pixels in the last frame before a shot are not aiming targets.',
      },
      targetMaxOffsetDeg: {
        type: 'number',
        default: 45,
        minimum: 0,
        maximum: 180,
        description:
          "The aiming target is the visible monster closest to the view direction, if it is within this angle (45° = the screen's edge).",
      },
    },
    additionalProperties: false,
  },
  create(ctx, params) {
    const discharges: Discharge[] = [];
    // Discharges waiting for their tic's player state: events arrive before the tic's record.
    let pending: Discharge[] = [];
    const missiles = new Map<number, Discharge>();
    const monsters = new Set<number>();
    let visible: VisibleMonster[] = [];
    const byPlayer = (id: number | null) => id !== null && id === ctx.playerId;

    const aim = (shot: Discharge, view: TicState): void => {
      shot.weapon = view.weapon;
      let best: { id: number; offset: number; distance: number } | null = null;
      for (const monster of shot.candidates) {
        const offset = viewOffset(view, monster.x, monster.y);
        if (Math.abs(offset) > params.targetMaxOffsetDeg) continue;
        if (!best || Math.abs(offset) < Math.abs(best.offset)) {
          best = { id: monster.id, offset, distance: distance(view, monster) };
        }
      }
      if (!best) return;
      shot.target = best.id;
      shot.error_deg = round(best.offset, 2);
      shot.target_distance = round(best.distance, 1);
    };

    return {
      onFrame(frame) {
        visible = frame.visible.filter((monster) => monster.pixels >= params.minPixels);
        for (const monster of frame.visible) monsters.add(monster.id);
      },
      onTic(tic) {
        for (const monster of tic.monsters) monsters.add(monster.id);
        for (const shot of pending) if (shot.tic === tic.tic) aim(shot, tic);
        pending = pending.filter((shot) => shot.tic > tic.tic);
      },
      onEvent(event) {
        if (event.type === 'shot' && byPlayer(event.shooter)) {
          let shot = discharges.at(-1);
          if (!shot || shot.tic !== event.tic || event.missile !== null) {
            shot = {
              tic: event.tic,
              weapon: null,
              pellets: 0,
              hits: 0,
              target: null,
              error_deg: null,
              target_distance: null,
              candidates: visible,
            };
            discharges.push(shot);
            pending.push(shot);
          }
          shot.pellets++;
          if (event.missile !== null) missiles.set(event.missile, shot);
        } else if (event.type === 'hit' && byPlayer(event.shooter) && event.monster) {
          const shot = discharges.at(-1);
          if (shot && shot.tic === event.tic) shot.hits++;
        } else if (event.type === 'damage' && event.inflictor !== null && event.target !== null) {
          const shot = missiles.get(event.inflictor);
          if (shot && monsters.has(event.target)) shot.hits++;
        }
      },
      finish() {
        const hitShots = discharges.filter((shot) => shot.hits > 0).length;
        const errors = discharges.flatMap((shot) => (shot.error_deg === null ? [] : [Math.abs(shot.error_deg)]));
        return {
          summary: {
            discharges: discharges.length,
            hit_discharges: hitShots,
            accuracy: discharges.length ? round(hitShots / discharges.length, 3) : null,
            pellets: discharges.reduce((sum, shot) => sum + shot.pellets, 0),
            monster_hits: discharges.reduce((sum, shot) => sum + shot.hits, 0),
            targeted: errors.length,
            median_abs_error_deg: errors.length ? round(median(errors)!, 2) : null,
          },
          raw: toColumns(discharges, COLUMNS),
        };
      },
    };
  },
};
