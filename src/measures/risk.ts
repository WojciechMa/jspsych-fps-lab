// risk: damage taken and its sources, hazardous floors, and fights entered at low health.
import type { Measure } from './types';
import { toColumns } from './util';

interface Params {
  lowHealth: number;
  engagementGapTics: number;
  hazardSpecials: number[];
}

/** A stretch of fighting: player shots, damage dealt to monsters or taken from monsters. */
interface Engagement {
  start_tic: number;
  end_tic: number;
  start_health: number;
  min_health: number;
}

export const risk: Measure<Params> = {
  id: 'risk',
  version: '1.0.0',
  label: 'Risk taking',
  participantDescription:
    'The damage you take and where it comes from, when you step onto harmful floors, and fights you start while low on health.',
  needs: ['tics', 'monsters', 'frames', 'events'],
  estBytesPerMin: 1_500,
  paramsSchema: {
    type: 'object',
    properties: {
      lowHealth: {
        type: 'integer',
        default: 25,
        minimum: 1,
        maximum: 200,
        description: 'An engagement counts as "at low health" when it starts with health at or below this value.',
      },
      engagementGapTics: {
        type: 'integer',
        default: 70,
        minimum: 1,
        description: 'Combat events (shots, damage dealt or taken) less than this many tics apart belong to one engagement (70 tics = 2 s).',
      },
      hazardSpecials: {
        type: 'array',
        items: { type: 'integer' },
        default: [4, 5, 7, 11, 16],
        description:
          "Sector specials of damaging floors: Doom's 7 (5 damage), 5 (10), and 4, 11 and 16 (20), dealt every 32 tics to a player standing on them. Entering such a sector counts as a hazard crossing.",
      },
    },
    additionalProperties: false,
  },
  create(ctx, params) {
    const types = new Map<number, number>();
    const damageBySource: Record<string, number> = {};
    const engagements: Engagement[] = [];
    const healthByTic: number[] = [];
    let current: Engagement | null = null;
    let health: number | null = null;
    let minHealth: number | null = null;
    let damageTaken = 0;
    let hitsTaken = 0;
    let environmentDamage = 0;
    let inHazard = false;
    let hazardCrossings = 0;
    let hazardTics = 0;
    const isPlayer = (id: number | null) => id !== null && id === ctx.playerId;

    const combat = (tic: number): void => {
      if (!current || tic - current.end_tic > params.engagementGapTics) {
        // A pistol start has 100 health before the first tic arrives.
        const now = health ?? 100;
        current = { start_tic: tic, end_tic: tic, start_health: now, min_health: now };
        engagements.push(current);
      }
      current.end_tic = tic;
    };

    return {
      onTic(tic) {
        health = tic.health;
        healthByTic[tic.tic] = tic.health;
        minHealth = Math.min(minHealth ?? tic.health, tic.health);
        for (const monster of tic.monsters) types.set(monster.id, monster.type);
        const hazard = params.hazardSpecials.includes(tic.sectorSpecial);
        if (hazard) {
          hazardTics++;
          if (!inHazard) hazardCrossings++;
        }
        inHazard = hazard;
      },
      onFrame(frame) {
        for (const monster of frame.visible) types.set(monster.id, monster.type);
      },
      onEvent(event) {
        if (event.type === 'shot' && isPlayer(event.shooter)) {
          combat(event.tic);
        } else if (event.type === 'damage' && isPlayer(event.target)) {
          damageTaken += event.amount;
          hitsTaken++;
          if (event.source === null) {
            environmentDamage += event.amount;
          } else {
            const source = isPlayer(event.source) ? 'self' : String(types.get(event.source) ?? 'unknown');
            damageBySource[source] = (damageBySource[source] ?? 0) + event.amount;
            combat(event.tic);
          }
        } else if (event.type === 'damage' && isPlayer(event.source) && event.target !== null && types.has(event.target)) {
          combat(event.tic);
        }
      },
      finish(end) {
        for (const e of engagements) {
          for (let t = e.start_tic; t <= e.end_tic; t++) {
            if (healthByTic[t] !== undefined) e.min_health = Math.min(e.min_health, healthByTic[t]);
          }
        }
        return {
          summary: {
            damage_taken: damageTaken,
            hits_taken: hitsTaken,
            environment_damage: environmentDamage,
            /** Keyed by monster type number, "self" or "unknown". */
            damage_by_source_type: damageBySource,
            min_health: minHealth,
            hazard_crossings: hazardCrossings,
            hazard_tics: hazardTics,
            engagements: engagements.length,
            engagements_at_low_health: engagements.filter((e) => e.start_health <= params.lowHealth).length,
            died: end.reason === 'death',
          },
          raw: { engagements: toColumns(engagements, ['start_tic', 'end_tic', 'start_health', 'min_health']) },
        };
      },
    };
  },
};
