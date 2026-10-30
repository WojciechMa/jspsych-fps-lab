// Runs a trial's measures: checks their parameters up front, feeds them the engine's data and
// collects their results. A measure that throws is switched off for the rest of the trial and
// reports its error instead of a result, so one faulty measure doesn't lose the trial.
import type { FrameState, GameEvent, PageEvent, TicState, TrialEnd, TrialListener } from '../engine/types';
import { type AnyMeasure, getMeasure, type MeasureSpec, resolveParams } from './registry';
import type { MeasureContext, MeasureInstance, MeasureResult, TrialInfo } from './types';

export const TICS_PER_SECOND = 35;

export interface ActiveMeasure {
  id: string;
  version: string;
  params: Record<string, unknown>;
}

export type MeasureOutcome = MeasureResult | { error: string };

export class MeasureRunner implements TrialListener {
  /** Ids, versions and resolved parameters, recorded with the trial. */
  readonly active: readonly ActiveMeasure[];
  private readonly measures: AnyMeasure[];
  private instances: (MeasureInstance | null)[] = [];
  private readonly errors = new Map<number, string>();
  private readonly controller = new AbortController();
  private ctx: MeasureContext | null = null;

  /** Throws on unknown measures, duplicates and invalid parameters. */
  constructor(specs: readonly MeasureSpec[]) {
    const normalized = specs.map((spec) => (typeof spec === 'string' ? { id: spec } : spec));
    const seen = new Set<string>();
    for (const { id } of normalized) {
      if (seen.has(id)) throw new Error(`Measure "${id}" is listed twice.`);
      seen.add(id);
    }
    this.measures = normalized.map(({ id }) => getMeasure(id));
    this.active = normalized.map((spec, i) => ({
      id: spec.id,
      version: this.measures[i].version,
      params: resolveParams(this.measures[i], spec.params),
    }));
  }

  /** Creates the measures. Call it when play starts; input_log listens from then on. */
  start(trial: TrialInfo, inputTarget: EventTarget | null): void {
    const ctx: MeasureContext = {
      ticRate: TICS_PER_SECOND,
      trial,
      playerId: null,
      inputTarget,
      signal: this.controller.signal,
    };
    this.ctx = ctx;
    this.instances = this.measures.map(() => null);
    this.measures.forEach((measure, i) => {
      this.instances[i] = this.guard(i, () => measure.create(ctx, this.active[i].params)) ?? null;
    });
  }

  onStart(playerId: number): void {
    if (this.ctx) this.ctx.playerId = playerId;
  }

  onTic(tic: TicState): void {
    this.each((m) => m.onTic?.(tic));
  }

  onEvent(event: GameEvent): void {
    this.each((m) => m.onEvent?.(event));
  }

  onFrame(frame: FrameState): void {
    this.each((m) => m.onFrame?.(frame));
  }

  onPage(event: PageEvent): void {
    this.each((m) => m.onPage?.(event));
  }

  /** Collects every measure's result, keyed by measure id, and stops listening. */
  finish(end: TrialEnd): Record<string, MeasureOutcome> {
    const results: Record<string, MeasureOutcome> = {};
    this.active.forEach(({ id }, i) => {
      const instance = this.instances[i];
      const result = instance ? this.guard(i, () => instance.finish(end)) : undefined;
      results[id] = result ?? { error: this.errors.get(i) ?? 'The measure did not start.' };
    });
    this.controller.abort();
    return results;
  }

  /** Stops listening without results, e.g. when the trial failed. */
  dispose(): void {
    this.controller.abort();
  }

  private each(call: (instance: MeasureInstance) => void): void {
    this.instances.forEach((instance, i) => {
      if (instance) this.guard(i, () => call(instance));
    });
  }

  private guard<T>(i: number, run: () => T): T | undefined {
    try {
      return run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Measure ${this.active[i].id} failed:`, error);
      this.errors.set(i, message);
      this.instances[i] = null;
      return undefined;
    }
  }
}
