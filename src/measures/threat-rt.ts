// threat_rt: per monster, when it first became visible and how quickly the player turned toward
// it, fired, and hit it.
import type { TicState } from '../engine/types';
import type { Measure } from './types';
import { distance, median, round, toColumns, viewOffset } from './util';

interface Params {
  minPixels: number;
  turnTowardDeg: number;
}

interface Sighting {
  id: number;
  type: number;
  frame: number;
  /** First tic run after the frame that showed the monster. */
  visible_tic: number;
  visible_ms: number;
  pixels: number;
  light: number;
  distance: number;
  /** Angle from the view direction to the monster; positive = to the left. */
  offset_deg: number;
  turn_tic: number | null;
  shot_tic: number | null;
  hit_tic: number | null;
  kill_tic: number | null;
}

const COLUMNS = [
  'id', 'type', 'frame', 'visible_tic', 'visible_ms', 'pixels', 'light', 'distance', 'offset_deg',
  'turn_tic', 'shot_tic', 'hit_tic', 'kill_tic', 'rt_turn_tics', 'rt_shot_tics', 'rt_hit_tics',
  'rt_turn_ms', 'rt_shot_ms', 'rt_hit_ms',
] as const;

export const threatRt: Measure<Params> = {
  id: 'threat_rt',
  version: '1.0.0',
  label: 'Threat reaction time',
  participantDescription:
    'When monsters first appear on your screen, and how quickly you turn toward them, shoot, and hit them.',
  needs: ['tics', 'monsters', 'frames', 'events', 'page'],
  estBytesPerMin: 3_000,
  paramsSchema: {
    type: 'object',
    properties: {
      minPixels: {
        type: 'integer',
        default: 20,
        minimum: 1,
        description:
          'A monster becomes visible in the first frame that draws at least this many of its pixels (after clipping by walls; the frame is 320×200).',
      },
      turnTowardDeg: {
        type: 'number',
        default: 5,
        minimum: 0,
        description:
          'Turning toward a monster: the angle between the view direction and the monster has shrunk by at least this many degrees since it became visible. Monsters that appear closer to the centre get no turn time.',
      },
    },
    additionalProperties: false,
  },
  create(ctx, params) {
    const sightings = new Map<number, Sighting>();
    const positions = new Map<number, { x: number; y: number }>();
    const ticTimes: number[] = [];
    // First tic not yet run at each pause.
    const pauseTics: number[] = [];
    let view: TicState | null = null;
    const byPlayer = (id: number | null) => id !== null && id === ctx.playerId;
    const sighting = (id: number | null) => (id === null ? undefined : sightings.get(id));

    return {
      onTic(tic) {
        ticTimes[tic.tic] = tic.timeMs;
        view = tic;
        for (const monster of tic.monsters) positions.set(monster.id, monster);
        for (const s of sightings.values()) {
          const position = positions.get(s.id);
          if (s.turn_tic !== null || !position) continue;
          if (Math.abs(viewOffset(tic, position.x, position.y)) <= Math.abs(s.offset_deg) - params.turnTowardDeg) {
            s.turn_tic = tic.tic;
          }
        }
      },
      onFrame(frame) {
        for (const monster of frame.visible) {
          positions.set(monster.id, monster);
          if (!view || monster.pixels < params.minPixels || sightings.has(monster.id)) continue;
          sightings.set(monster.id, {
            id: monster.id,
            type: monster.type,
            frame: frame.frame,
            visible_tic: frame.tic,
            visible_ms: round(frame.timeMs, 1),
            pixels: monster.pixels,
            light: monster.light,
            distance: round(distance(view, monster), 1),
            offset_deg: round(viewOffset(view, monster.x, monster.y), 2),
            turn_tic: null,
            shot_tic: null,
            hit_tic: null,
            kill_tic: null,
          });
        }
      },
      onEvent(event) {
        switch (event.type) {
          case 'shot':
            if (byPlayer(event.shooter)) for (const s of sightings.values()) s.shot_tic ??= event.tic;
            break;
          case 'hit': {
            const s = sighting(event.target);
            if (s && byPlayer(event.shooter)) s.hit_tic ??= event.tic;
            break;
          }
          case 'damage': {
            // Covers missiles and melee as well as bullets.
            const s = sighting(event.target);
            if (s && byPlayer(event.source)) s.hit_tic ??= event.tic;
            break;
          }
          case 'kill': {
            const s = sighting(event.target);
            if (s) s.kill_tic ??= event.tic;
            break;
          }
        }
      },
      onPage(event) {
        if (event.type === 'pause') pauseTics.push(event.tic);
      },
      finish() {
        const rtTics = (tic: number | null, s: Sighting): number | null => (tic === null ? null : tic - s.visible_tic);
        // Times in ms would include the pause, so they are left out when one fell in between.
        const rtMs = (tic: number | null, s: Sighting): number | null =>
          tic === null ||
          ticTimes[tic] === undefined ||
          pauseTics.some((paused) => paused >= s.visible_tic && paused <= tic)
            ? null
            : round(ticTimes[tic] - s.visible_ms, 1);
        const rows = [...sightings.values()].map((s) => ({
          ...s,
          rt_turn_tics: rtTics(s.turn_tic, s),
          rt_shot_tics: rtTics(s.shot_tic, s),
          rt_hit_tics: rtTics(s.hit_tic, s),
          rt_turn_ms: rtMs(s.turn_tic, s),
          rt_shot_ms: rtMs(s.shot_tic, s),
          rt_hit_ms: rtMs(s.hit_tic, s),
        }));
        const medianOf = (key: 'rt_turn_ms' | 'rt_shot_ms' | 'rt_hit_ms'): number | null => {
          const value = median(rows.flatMap((row) => (row[key] === null ? [] : [row[key]])));
          return value === null ? null : round(value, 1);
        };
        return {
          summary: {
            monsters_seen: rows.length,
            turned: rows.filter((row) => row.turn_tic !== null).length,
            shot: rows.filter((row) => row.shot_tic !== null).length,
            hit: rows.filter((row) => row.hit_tic !== null).length,
            median_rt_turn_ms: medianOf('rt_turn_ms'),
            median_rt_shot_ms: medianOf('rt_shot_ms'),
            median_rt_hit_ms: medianOf('rt_hit_ms'),
          },
          raw: toColumns(rows, COLUMNS),
        };
      },
    };
  },
};
