// The study builder's editable state and its conversion to and from a study config. The builder
// gives all trials one set of measures; per-trial measures stay possible by editing the JSON.
import { DEFAULT_MEASURES, getMeasure, MEASURES, resolveParams, type MeasureSpec } from '../measures/registry';
import type { Paradigm } from '../paradigms/registry';
import {
  allTrials,
  type BlockConfig,
  type QuestionConfig,
  type QuestionnaireConfig,
  type SaveTargetId,
  type StudyConfig,
  type TrialConfig,
  trialMeasures,
  trialParadigm,
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
  fullscreen: boolean;
  /** Comma- or space-separated names. */
  url_params: string;
  completion_url: string;
  target: SaveTargetId;
  datapipe_experiment_id: string;
  jatos: NonNullable<StudyConfig['jatos']>;
  /** Map WADs from public/wads/manifest.json. */
  wads: string[];
  measures: Record<string, MeasureChoice>;
  /** Trials without `measures`: those come from `Draft.measures`. */
  blocks: BlockConfig[];
  /** May hold fields of other question types; toConfig keeps only the page type's. */
  questionnaires: QuestionnaireConfig[];
}

export type ExportedConfig = StudyConfig & { $schema: string };

export const newTrial = (): TrialConfig => ({ map: 1, skill: 3, time_limit: 300 });

export const newQuestion = (n: number): QuestionConfig => ({
  name: `q${n}`,
  prompt: '',
  labels: ['Strongly disagree', 'Disagree', 'Neither', 'Agree', 'Strongly agree'],
  options: ['Yes', 'No'],
});

export function defaultMeasures(ids: readonly string[] = DEFAULT_MEASURES): Record<string, MeasureChoice> {
  return Object.fromEntries(MEASURES.map((measure) => [measure.id, { on: ids.includes(measure.id), params: resolveParams(measure) }]));
}

export function blankDraft(): Draft {
  return {
    id: 'my-study',
    title: 'My study',
    content_warning: '',
    consent_html: '',
    instructions_html: '',
    fullscreen: true,
    url_params: '',
    completion_url: '',
    target: 'download',
    datapipe_experiment_id: '',
    jatos: { study_uuid: '', component_uuid: '', batch_uuid: '' },
    wads: [],
    measures: defaultMeasures(),
    blocks: [{ trials: [newTrial()] }],
    questionnaires: [],
  };
}

/** The ticked measures, with only the parameters that differ from their defaults. */
export function measureSpecs(draft: Draft): MeasureSpec[] {
  const specs: MeasureSpec[] = [];
  for (const measure of MEASURES) {
    const choice = draft.measures[measure.id];
    if (!choice?.on) continue;
    const defaults = resolveParams(measure);
    const changed = Object.entries(choice.params).filter(
      ([name, value]) => JSON.stringify(value) !== JSON.stringify(defaults[name]),
    );
    specs.push(changed.length ? { id: measure.id, params: Object.fromEntries(changed) } : measure.id);
  }
  return specs;
}

/** Whether specs are exactly the paradigm's default measures with default parameters. */
export function isParadigmDefault(specs: readonly MeasureSpec[], paradigm: Paradigm): boolean {
  const ids = specs.map((spec) => (typeof spec === 'string' ? spec : null));
  return ids.length === paradigm.defaultMeasures.length && ids.every((id) => id !== null && paradigm.defaultMeasures.includes(id));
}

/** A trial's paradigm params that differ from the defaults (unknown ones kept, for the checks to report). */
function changedParams(trial: TrialConfig): Record<string, unknown> | undefined {
  const defaults = resolveParams(trialParadigm(trial));
  const changed = Object.entries(trial.params ?? {}).filter(
    ([name, value]) => JSON.stringify(value) !== JSON.stringify(defaults[name]),
  );
  return changed.length ? Object.fromEntries(changed) : undefined;
}

/** The config to commit: empty texts and default values left out, fields in schema order. */
export function toConfig(draft: Draft): ExportedConfig {
  const text = (value: string): string | undefined => value.trim() || undefined;
  const lines = (values: string[] | undefined): string[] => (values ?? []).map((v) => v.trim()).filter(Boolean);
  const urlParams = draft.url_params.split(/[\s,]+/).filter(Boolean);
  const measures = measureSpecs(draft);
  const config: ExportedConfig = {
    $schema: './schema.json',
    title: draft.title,
    content_warning: text(draft.content_warning),
    consent_html: text(draft.consent_html),
    instructions_html: text(draft.instructions_html),
    fullscreen: draft.fullscreen ? undefined : false,
    wads: draft.wads.length ? [...draft.wads] : undefined,
    url_params: urlParams.length ? urlParams : undefined,
    completion_url: text(draft.completion_url),
    save:
      draft.target === 'datapipe'
        ? { target: 'datapipe', datapipe_experiment_id: text(draft.datapipe_experiment_id) }
        : { target: draft.target },
    jatos: draft.target === 'jatos' ? { ...draft.jatos } : undefined,
    blocks: draft.blocks.map((block) => ({
      name: text(block.name ?? ''),
      practice: block.practice || undefined,
      instructions_html: text(block.instructions_html ?? ''),
      trials: block.trials.map((trial) => ({
        paradigm: trial.paradigm && trial.paradigm !== 'classic' ? trial.paradigm : undefined,
        map: trial.map,
        skill: trial.skill ?? 3,
        time_limit: trial.time_limit,
        params: changedParams(trial),
        seed: trial.seed,
        no_monsters: trial.no_monsters || undefined,
        sound: trial.sound === false ? false : undefined,
        hud: trial.hud === false ? false : undefined,
        automap: trial.automap || undefined,
        prompt_html: text(trial.prompt_html ?? ''),
        measures: isParadigmDefault(measures, trialParadigm(trial)) ? undefined : measures,
      })),
    })),
    questionnaires: draft.questionnaires.length
      ? draft.questionnaires.map((page) => {
          const scale = page.type === 'likert';
          const options = page.type === 'choice' || page.type === 'multi_select';
          const typed = page.type === 'text';
          return {
            name: text(page.name ?? ''),
            type: page.type,
            preamble_html: text(page.preamble_html ?? ''),
            questions: page.questions.map((q) => ({
              name: q.name,
              prompt: q.prompt,
              required: q.required || undefined,
              labels: scale ? lines(q.labels) : undefined,
              options: options ? lines(q.options) : undefined,
              horizontal: options ? q.horizontal || undefined : undefined,
              rows: typed && q.rows !== undefined && q.rows !== 1 ? q.rows : undefined,
              placeholder: typed ? text(q.placeholder ?? '') : undefined,
            })),
          };
        })
      : undefined,
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
    fullscreen: config.fullscreen ?? true,
    url_params: (config.url_params ?? []).join(', '),
    completion_url: config.completion_url ?? '',
    target: config.save.target,
    datapipe_experiment_id: config.save.datapipe_experiment_id ?? '',
    jatos: config.jatos ? { ...config.jatos } : { study_uuid: '', component_uuid: '', batch_uuid: '' },
    wads: [...(config.wads ?? [])],
    measures,
    blocks: config.blocks.map((block) => ({
      ...block,
      trials: block.trials.map(({ measures: _measures, ...trial }) => ({ skill: 3, ...trial })),
    })),
    questionnaires: structuredClone(config.questionnaires ?? []),
  };
  const note = differ
    ? 'The trials in this file use different measures. The builder uses one set for all trials: the first trial\'s.'
    : null;
  return { draft, note };
}
