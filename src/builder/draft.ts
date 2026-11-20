// The study builder's editable state and its conversion to and from a study config. The builder
// gives all trials one set of measures; per-trial measures stay possible by editing the JSON.
import { getMeasure, MEASURES, resolveParams, type MeasureSpec } from '../measures/registry';
import {
  allTrials,
  type BlockConfig,
  type SaveTargetId,
  type StudyConfig,
  type TrialConfig,
  trialMeasures,
} from '../study/config';

export interface MeasureChoice {
  on: boolean;
  params: Record<string, unknown>;
}

export interface Draft {
  id: string;
  title: string;
  content_warning: string;
  consent_html: string;
  instructions_html: string;
  /** Comma- or space-separated names. */
  url_params: string;
  completion_url: string;
  target: SaveTargetId;
  datapipe_experiment_id: string;
  jatos: NonNullable<StudyConfig['jatos']>;
  measures: Record<string, MeasureChoice>;
  /** Trials without `measures`: those come from `Draft.measures`. */
  blocks: BlockConfig[];
}

export type ExportedConfig = StudyConfig & { $schema: string };

export const newTrial = (): TrialConfig => ({ map: 1, skill: 3, time_limit: 300 });

export function defaultMeasures(): Record<string, MeasureChoice> {
  return Object.fromEntries(MEASURES.map((measure) => [measure.id, { on: true, params: resolveParams(measure) }]));
}

export function blankDraft(): Draft {
  return {
    id: 'my-study',
    title: 'My study',
    content_warning: '',
    consent_html: '',
    instructions_html: '',
    url_params: '',
    completion_url: '',
    target: 'download',
    datapipe_experiment_id: '',
    jatos: { study_uuid: '', component_uuid: '', batch_uuid: '' },
    measures: defaultMeasures(),
    blocks: [{ trials: [newTrial()] }],
  };
}

/** The trials' measure list; undefined when it equals the default (all measures, default parameters). */
export function measureSpecs(draft: Draft): MeasureSpec[] | undefined {
  const specs: MeasureSpec[] = [];
  let allDefault = true;
  for (const measure of MEASURES) {
    const choice = draft.measures[measure.id];
    if (!choice?.on) {
      allDefault = false;
      continue;
    }
    const defaults = resolveParams(measure);
    const changed = Object.entries(choice.params).filter(
      ([name, value]) => JSON.stringify(value) !== JSON.stringify(defaults[name]),
    );
    if (changed.length) {
      allDefault = false;
      specs.push({ id: measure.id, params: Object.fromEntries(changed) });
    } else {
      specs.push(measure.id);
    }
  }
  return allDefault ? undefined : specs;
}

/** The config to commit: empty texts and default values left out, fields in schema order. */
export function toConfig(draft: Draft): ExportedConfig {
  const text = (value: string): string | undefined => value.trim() || undefined;
  const urlParams = draft.url_params.split(/[\s,]+/).filter(Boolean);
  const measures = measureSpecs(draft);
  const config: ExportedConfig = {
    $schema: './schema.json',
    title: draft.title,
    content_warning: text(draft.content_warning),
    consent_html: text(draft.consent_html),
    instructions_html: text(draft.instructions_html),
    url_params: urlParams.length ? urlParams : undefined,
    completion_url: text(draft.completion_url),
    save:
      draft.target === 'datapipe'
        ? { target: 'datapipe', datapipe_experiment_id: text(draft.datapipe_experiment_id) }
        : { target: draft.target },
    jatos: draft.target === 'jatos' ? { ...draft.jatos } : undefined,
    blocks: draft.blocks.map((block) => ({
      name: text(block.name ?? ''),
      instructions_html: text(block.instructions_html ?? ''),
      trials: block.trials.map((trial) => ({
        map: trial.map,
        skill: trial.skill ?? 3,
        time_limit: trial.time_limit,
        no_monsters: trial.no_monsters || undefined,
        sound: trial.sound === false ? false : undefined,
        prompt_html: text(trial.prompt_html ?? ''),
        measures,
      })),
    })),
  };
  // Drops the undefined fields.
  return JSON.parse(JSON.stringify(config)) as ExportedConfig;
}

/** Draft from a schema-valid config; throws on unknown measures. `note` explains anything lost. */
export function fromConfig(config: StudyConfig, id: string): { draft: Draft; note: string | null } {
  const trials = allTrials(config);
  const differ = new Set(trials.map((trial) => JSON.stringify(trialMeasures(trial)))).size > 1;
  const measures = Object.fromEntries(
    MEASURES.map((measure) => [measure.id, { on: false, params: resolveParams(measure) }]),
  );
  for (const spec of trialMeasures(trials[0])) {
    const measure = getMeasure(typeof spec === 'string' ? spec : spec.id);
    const given = typeof spec === 'string' ? {} : (spec.params ?? {});
    measures[measure.id] = { on: true, params: resolveParams(measure, given) };
  }
  const draft: Draft = {
    id,
    title: config.title,
    content_warning: config.content_warning ?? '',
    consent_html: config.consent_html ?? '',
    instructions_html: config.instructions_html ?? '',
    url_params: (config.url_params ?? []).join(', '),
    completion_url: config.completion_url ?? '',
    target: config.save.target,
    datapipe_experiment_id: config.save.datapipe_experiment_id ?? '',
    jatos: config.jatos ? { ...config.jatos } : { study_uuid: '', component_uuid: '', batch_uuid: '' },
    measures,
    blocks: config.blocks.map((block) => ({
      ...block,
      trials: block.trials.map(({ measures: _measures, ...trial }) => ({ skill: 3, ...trial })),
    })),
  };
  const note = differ
    ? 'The trials in this file use different measures. The builder uses one set for all trials: the first trial\'s.'
    : null;
  return { draft, note };
}
