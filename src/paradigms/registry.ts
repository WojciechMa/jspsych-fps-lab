// Paradigm registry (AGENTS.md, "Paradigms"). A paradigm is a kind of trial: its maps, its game
// logic (engine mode; 0 = unmodified Doom), what ends a trial and which measures it records by
// default. Study configs pick one per trial.
import type { EndReason } from '../engine/types';
import { DEFAULT_MEASURES, resolveParams } from '../measures/registry';
import type { ParamsSchema } from '../measures/types';

export interface Paradigm {
  id: string;
  /** MAJOR when the task changes so that trials can't be pooled, MINOR/PATCH otherwise. */
  version: string;
  label: string;
  /** HTML shown before each trial unless the trial sets its own prompt. */
  participantInstructions: string;
  /** Engine mode passed to the trial; 0 = unmodified Doom. */
  mode: number;
  paramsSchema: ParamsSchema;
  /** "iwad": any map of the IWAD; "pwad": only maps built for this paradigm (public/wads/manifest.json). */
  maps: 'iwad' | 'pwad';
  endConditions: readonly EndReason[];
  defaultMeasures: readonly string[];
  /** The resolved params as the engine mode's integer params (dg_set_param). */
  engineParams(params: Record<string, unknown>): number[];
  /** Problems the schema can't express, e.g. between params. */
  checkParams?(params: Record<string, unknown>): string[];
}

const NO_PARAMS: ParamsSchema = { type: 'object', properties: {}, additionalProperties: false };

const TICS_PER_SECOND = 35;

/** Engine order (threat_types in engine/web/dg_mode.c). */
export const THREAT_MONSTERS = ['zombieman', 'shotgun_guy', 'imp', 'demon'] as const;

/** Engine param slots for reversals (params 9–15 of mode 2). */
const BANDIT_REVERSALS = 7;

/** A probability as the engine's fixed point (65536 = 1). */
const fixed = (p: unknown) => Math.round((p as number) * 65536);

function checkBandit(p: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const reversals = p.reversals as number[];
  const choices = p.choices as number;
  if (reversals.length > BANDIT_REVERSALS) problems.push(`reversals may list at most ${BANDIT_REVERSALS} choices`);
  if (reversals.some((r, i) => r < 1 || r >= choices || (i > 0 && r <= reversals[i - 1]))) {
    problems.push('reversals must be ascending choice numbers from 1 to choices − 1');
  }
  if (p.schedule === 'drifting') {
    if (reversals.length) problems.push('reversals apply to the fixed schedule only');
    const min = p.drift_min as number, max = p.drift_max as number;
    if (min >= max) problems.push('drift_min must be smaller than drift_max');
    for (const name of ['p_left', 'p_right']) {
      const v = p[name] as number;
      if (v < min || v > max) problems.push(`${name} must lie between drift_min and drift_max`);
    }
  }
  return problems;
}

export const PARADIGMS: readonly Paradigm[] = [
  {
    id: 'classic',
    version: '1.0.0',
    label: 'Classic Doom level',
    participantInstructions: '<p>Find the exit of the level.</p>',
    mode: 0,
    paramsSchema: NO_PARAMS,
    maps: 'iwad',
    endConditions: ['exit', 'secret_exit', 'death', 'timeout'],
    defaultMeasures: DEFAULT_MEASURES,
    engineParams: () => [],
  },
  {
    id: 'maze',
    version: '1.0.0',
    label: 'Maze navigation',
    participantInstructions:
      '<p>Find the way out of the maze. The exit is a room whose walls and floor look different; ' +
      'walking into it ends the round.</p>',
    mode: 0,
    paramsSchema: NO_PARAMS,
    maps: 'pwad',
    endConditions: ['exit', 'timeout'],
    defaultMeasures: ['session_quality', 'input_log', 'trajectory', 'roi', 'demo'],
    engineParams: () => [],
  },
  {
    id: 'threat-corridor',
    version: '1.0.0',
    label: 'Threat reaction corridor',
    participantInstructions:
      '<p>Monsters appear one at a time in the alcoves of the corridor: ahead, beside or behind you. ' +
      'Shoot each one as quickly as you can. The round ends when the last one is down.</p>',
    mode: 1,
    paramsSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        threats: {
          type: 'integer', minimum: 1, maximum: 100, default: 10,
          description: 'Monsters per trial, one at a time. The trial is complete when the last one is dead.',
        },
        min_delay_s: {
          type: 'number', minimum: 0, maximum: 60, default: 2,
          description: 'Shortest wait from a kill (or the trial start) to the next monster, in seconds; rounded to tics (1/35 s).',
        },
        max_delay_s: {
          type: 'number', minimum: 0, maximum: 60, default: 5,
          description: 'Longest wait. Each wait and each spawn spot are drawn uniformly from the trial seed.',
        },
        monster: {
          type: 'string', enum: THREAT_MONSTERS, default: 'zombieman',
          description: 'Monster type of every threat.',
        },
        attack: {
          type: 'boolean', default: false,
          description: 'Monsters see and attack the player. Off: they stand still, only flinching when hit.',
        },
        teleport_fog: {
          type: 'boolean', default: true,
          description: 'Each monster appears with the teleport flash and sound.',
        },
      },
    },
    maps: 'pwad',
    endConditions: ['complete', 'death', 'timeout'],
    defaultMeasures: ['session_quality', 'input_log', 'trajectory', 'threat_rt', 'aiming', 'demo'],
    engineParams: (p) => [
      p.threats as number,
      Math.round((p.min_delay_s as number) * TICS_PER_SECOND),
      Math.round((p.max_delay_s as number) * TICS_PER_SECOND),
      THREAT_MONSTERS.indexOf(p.monster as (typeof THREAT_MONSTERS)[number]),
      p.attack ? 1 : 0,
      p.teleport_fog ? 1 : 0,
    ],
    checkParams: (p) =>
      (p.min_delay_s as number) > (p.max_delay_s as number) ? ['min_delay_s must not be larger than max_delay_s'] : [],
  },
  {
    id: 'two-door-bandit',
    version: '1.0.0',
    label: 'Two-door bandit',
    participantInstructions:
      '<p>Walk through the left or the right door. Behind it you either score a point ' +
      '(a yellow flash and a chime) or not (a grunt). Then you are taken back to the start for the next choice.</p>' +
      '<p>One door scores more often than the other, and that can change during the round. ' +
      'Try to score as many points as you can.</p>',
    mode: 2,
    paramsSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        choices: {
          type: 'integer', minimum: 1, maximum: 200, default: 40,
          description: 'Choices per trial. The trial is complete after the feedback of the last one.',
        },
        schedule: {
          type: 'string', enum: ['fixed', 'drifting'], default: 'fixed',
          description: 'fixed: p_left/p_right stay the same, except that they swap after each choice listed in reversals. ' +
            'drifting (restless bandit): after each choice both take an independent Gaussian step (drift_sd), reflected at drift_min/drift_max.',
        },
        p_left: {
          type: 'number', minimum: 0, maximum: 1, default: 0.7,
          description: 'Reward probability of the left door (at the start, for drifting).',
        },
        p_right: {
          type: 'number', minimum: 0, maximum: 1, default: 0.3,
          description: 'Reward probability of the right door (at the start, for drifting).',
        },
        reversals: {
          type: 'array', items: { type: 'integer' }, default: [],
          description: `Fixed schedule: choice numbers after which the two probabilities swap (ascending, at most ${BANDIT_REVERSALS}).`,
        },
        drift_sd: {
          type: 'number', minimum: 0, maximum: 0.5, default: 0.025,
          description: 'Drifting schedule: SD of each step (approximately Gaussian: sum of 12 uniforms from the trial seed).',
        },
        drift_min: {
          type: 'number', minimum: 0, maximum: 1, default: 0.25,
          description: 'Drifting schedule: lower bound of both probabilities.',
        },
        drift_max: {
          type: 'number', minimum: 0, maximum: 1, default: 0.75,
          description: 'Drifting schedule: upper bound of both probabilities.',
        },
        feedback_s: {
          type: 'number', minimum: 0, maximum: 5, default: 1,
          description: 'Seconds the player stands still after a choice before returning to the start; rounded to tics.',
        },
        show_score: {
          type: 'boolean', default: true,
          description: 'Show "Score: n" after each choice (needs the HUD).',
        },
      },
    },
    maps: 'pwad',
    endConditions: ['complete', 'timeout'],
    defaultMeasures: ['session_quality', 'input_log', 'trajectory', 'roi', 'bandit', 'demo'],
    engineParams: (p) => {
      const reversals = p.reversals as number[];
      return [
        p.choices as number,
        p.schedule === 'drifting' ? 1 : 0,
        fixed(p.p_left),
        fixed(p.p_right),
        fixed(p.drift_sd),
        fixed(p.drift_min),
        fixed(p.drift_max),
        Math.round((p.feedback_s as number) * TICS_PER_SECOND),
        p.show_score ? 1 : 0,
        ...Array.from({ length: BANDIT_REVERSALS }, (_, i) => reversals[i] ?? 0),
      ];
    },
    checkParams: checkBandit,
  },
];

export function getParadigm(id: string): Paradigm {
  const paradigm = PARADIGMS.find((p) => p.id === id);
  if (!paradigm) throw new Error(`Unknown paradigm "${id}". Known: ${PARADIGMS.map((p) => p.id).join(', ')}.`);
  return paradigm;
}

/** A trial's paradigm params with defaults filled in; throws on invalid ones. */
export function resolveParadigmParams(paradigm: Paradigm, given: Record<string, unknown> = {}): Record<string, unknown> {
  const params = resolveParams(paradigm, given);
  const problems = paradigm.checkParams?.(params) ?? [];
  if (problems.length) throw new Error(`${paradigm.id}: ${problems.join('; ')}.`);
  return params;
}

/** A trial seed (uint32) for configs that leave it out: drawn once per trial and recorded. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
