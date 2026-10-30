// All measures, parameter checking and the participant-facing list of what is recorded.
import { aiming } from './aiming';
import { demo } from './demo';
import { inputLog } from './input-log';
import { risk } from './risk';
import { roi } from './roi';
import { sessionQuality } from './session-quality';
import { threatRt } from './threat-rt';
import { trajectory } from './trajectory';
import type { Measure, ParamSchema } from './types';

// Measures differ in their parameter types; resolveParams checks them against each schema.
export type AnyMeasure = Measure<any>;

export const MEASURES: readonly AnyMeasure[] = [
  sessionQuality, inputLog, trajectory, roi, threatRt, aiming, risk, demo,
];

/** Used when a trial doesn't list its measures ("classic" until paradigms define their own). */
export const DEFAULT_MEASURES: readonly string[] = MEASURES.map((measure) => measure.id);

/** A measure as a trial or study config names it. */
export type MeasureSpec = string | { id: string; params?: Record<string, unknown> };

export function getMeasure(id: string): AnyMeasure {
  const measure = MEASURES.find((m) => m.id === id);
  if (!measure) throw new Error(`Unknown measure "${id}". Known: ${MEASURES.map((m) => m.id).join(', ')}.`);
  return measure;
}

/** Fills in defaults and rejects unknown or invalid parameters. */
export function resolveParams(measure: AnyMeasure, given: Record<string, unknown> = {}): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(measure.paramsSchema.properties)) {
    params[name] = Array.isArray(schema.default) ? [...schema.default] : schema.default;
  }
  for (const [name, value] of Object.entries(given)) {
    const schema = measure.paramsSchema.properties[name];
    if (!schema) throw new Error(`${measure.id}: unknown parameter "${name}".`);
    const problem = checkParam(schema, value);
    if (problem) throw new Error(`${measure.id}.${name} ${problem}.`);
    params[name] = value;
  }
  return params;
}

function checkParam(schema: ParamSchema, value: unknown): string | null {
  switch (schema.type) {
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (schema.type === 'integer' && !Number.isInteger(value)) return 'must be a whole number';
      if (schema.minimum !== undefined && value < schema.minimum) return `must be at least ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `must be at most ${schema.maximum}`;
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'string':
      return typeof value === 'string' && schema.enum.includes(value) ? null : `must be one of: ${schema.enum.join(', ')}`;
    case 'array':
      return Array.isArray(value) && value.every(Number.isInteger) ? null : 'must be a list of whole numbers';
  }
}

/** What participants are told is recorded, one line per active measure. */
export function participantDescriptions(specs: readonly MeasureSpec[]): string[] {
  const ids = new Set(specs.map((spec) => (typeof spec === 'string' ? spec : spec.id)));
  return MEASURES.filter((measure) => ids.has(measure.id)).map((measure) => measure.participantDescription);
}
