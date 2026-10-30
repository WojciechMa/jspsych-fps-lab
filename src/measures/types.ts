// The measure interface (AGENTS.md, "Measures"). A measure turns a trial's engine data into
// `{ summary, raw }`; only active measures' outputs are stored, so the active set is exactly what
// is recorded.
import type { EngineInfo, FrameState, GameEvent, PageEvent, TicState, TrialEnd } from '../engine/types';

/** Data a measure reads. */
export type Need = 'tics' | 'monsters' | 'events' | 'frames' | 'page' | 'input' | 'demo';

/** JSON Schema subset for measure parameters; every parameter has a documented default. */
export type ParamSchema = { description: string } & (
  | { type: 'number' | 'integer'; default: number; minimum?: number; maximum?: number }
  | { type: 'boolean'; default: boolean }
  | { type: 'string'; enum: readonly string[]; default: string }
  | { type: 'array'; items: { type: 'integer' }; default: readonly number[] }
);

export interface ParamsSchema {
  type: 'object';
  properties: Readonly<Record<string, ParamSchema>>;
  additionalProperties: false;
}

/** What the trial is, for measures that record it (demo). */
export interface TrialInfo {
  paradigm: string;
  mode: number;
  params: Record<string, unknown>;
  seed: number | null;
  map: number;
  skill: number;
  noMonsters: boolean;
  engine: EngineInfo;
}

export interface MeasureContext {
  readonly ticRate: number;
  readonly trial: TrialInfo;
  /** The player's thing id; set before the first tic. */
  playerId: number | null;
  /** Where input_log listens (window in the browser); null where there is no live input. */
  readonly inputTarget: EventTarget | null;
  /** Aborted when the trial ends; use it to remove event listeners. */
  readonly signal: AbortSignal;
}

export interface MeasureResult {
  summary: Record<string, unknown>;
  raw?: unknown;
}

export interface MeasureInstance {
  onTic?(tic: TicState): void;
  onEvent?(event: GameEvent): void;
  onFrame?(frame: FrameState): void;
  onPage?(event: PageEvent): void;
  finish(end: TrialEnd): MeasureResult;
}

export interface Measure<P extends object = Record<string, unknown>> {
  id: string;
  version: string;
  label: string;
  /** Plain-language line for the consent and data screens. */
  participantDescription: string;
  needs: readonly Need[];
  /** Rough size of the output per minute of play, for the study builder's estimate. */
  estBytesPerMin: number;
  paramsSchema: ParamsSchema;
  create(ctx: MeasureContext, params: P): MeasureInstance;
}
