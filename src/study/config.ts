// Study configs (public/studies/<id>.json): types, defaults, loading and the checks beyond the
// JSON schema (measures and their parameters, data size against the save target's limits).
import { DEFAULT_MEASURES, getMeasure, type MeasureSpec } from '../measures/registry';
import { MeasureRunner } from '../measures/runner';
import { checkSchema, type Schema } from './schema-check';

export type SaveTargetId = 'download' | 'jatos' | 'datapipe';

export interface TrialConfig {
  map: number;
  skill?: number;
  time_limit: number;
  no_monsters?: boolean;
  sound?: boolean;
  prompt_html?: string;
  measures?: MeasureSpec[];
}

export interface BlockConfig {
  name?: string;
  instructions_html?: string;
  trials: TrialConfig[];
}

export interface StudyConfig {
  title: string;
  content_warning?: string;
  consent_html?: string;
  instructions_html?: string;
  iwad?: 'freedoom2.wad';
  face?: 'freedoom';
  url_params?: string[];
  completion_url?: string;
  save: { target: SaveTargetId; datapipe_experiment_id?: string };
  jatos?: { study_uuid: string; component_uuid: string; batch_uuid: string };
  blocks: BlockConfig[];
}

export const STUDY_ID = /^[a-z0-9-]+$/;

export const DEFAULT_CONTENT_WARNING =
  'This study uses a first-person video game with monsters, cartoon violence, sudden sounds and ' +
  'flashing lights. If you have photosensitive epilepsy or tend to feel sick when playing video ' +
  'games, please do not take part. You can pause with Esc and stop at any time by closing this ' +
  'page, without giving a reason.';

export const DEFAULT_INSTRUCTIONS_HTML = `
  <h1>How to play</h1>
  <p>W A S D move, the mouse turns, left click fires, E opens doors and presses switches, 1–7 switch
  weapons. Esc pauses the game.</p>
  <p>Each round ends at the level's exit, if you die, or when its time is up.</p>`;

// JATOS defaults (jatos.resultData.maxSize, jatos.resultFiles.maxSize/studyMaxSize); DataPipe: per request.
export const LIMITS = {
  jatos: { resultData: 5e6, file: 30e6, filesPerRun: 50e6 },
  datapipe: { request: 32e6 },
} as const;

/** Measure specs of a trial, with the default when the config lists none. */
export function trialMeasures(trial: TrialConfig): readonly MeasureSpec[] {
  return trial.measures ?? DEFAULT_MEASURES;
}

export function allTrials(config: StudyConfig): TrialConfig[] {
  return config.blocks.flatMap((block) => block.trials);
}

/** Estimated output in bytes: per trial and measure, and in total. */
export function estimateBytes(config: StudyConfig): { perTrialMeasure: number[][]; total: number } {
  const perTrialMeasure = allTrials(config).map((trial) =>
    trialMeasures(trial).map((spec) => {
      const measure = getMeasure(typeof spec === 'string' ? spec : spec.id);
      return Math.ceil((measure.estBytesPerMin * trial.time_limit) / 60);
    }),
  );
  const total = perTrialMeasure.flat().reduce((sum, bytes) => sum + bytes, 0);
  return { perTrialMeasure, total };
}

/** Schema check plus everything the schema can't express. Returns all problems found. */
export function checkStudy(config: unknown, schema: Schema): string[] {
  const problems = checkSchema(config, schema);
  if (problems.length) return problems;
  const study = config as StudyConfig;
  allTrials(study).forEach((trial, i) => {
    try {
      new MeasureRunner(trialMeasures(trial));
    } catch (error) {
      problems.push(`trial ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  if (problems.length) return problems;

  const { perTrialMeasure, total } = estimateBytes(study);
  const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;
  if (study.save.target === 'jatos') {
    if (!study.jatos) problems.push('config.jatos (study, component and batch UUIDs) is needed to save to JATOS');
    const largest = Math.max(...perTrialMeasure.flat());
    if (largest > LIMITS.jatos.file) {
      problems.push(`one measure's file is estimated at ${mb(largest)}, over JATOS's ${mb(LIMITS.jatos.file)} per file`);
    }
    if (total > LIMITS.jatos.filesPerRun) {
      problems.push(`the session is estimated at ${mb(total)}, over JATOS's ${mb(LIMITS.jatos.filesPerRun)} of files per run`);
    }
  }
  if (study.save.target === 'datapipe') {
    if (!study.save.datapipe_experiment_id) problems.push('config.save.datapipe_experiment_id is needed to save to DataPipe');
    perTrialMeasure.forEach((bytes, i) => {
      const sum = bytes.reduce((a, b) => a + b, 0);
      if (sum > LIMITS.datapipe.request) {
        problems.push(`trial ${i + 1} is estimated at ${mb(sum)}, over DataPipe's ${mb(LIMITS.datapipe.request)} per request`);
      }
    });
  }
  return problems;
}

/** Fetches a JSON file of the site, e.g. studies/<id>.json. */
export async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  // The Vite dev server answers missing files with index.html, so check the type too.
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    throw new Error(`${path} not found`);
  }
  return response.json();
}

/** Loads and checks studies/<id>.json; throws with every problem listed. */
export async function loadStudy(
  id: string,
  fetchJson: (path: string) => Promise<unknown>,
): Promise<StudyConfig> {
  if (!STUDY_ID.test(id)) throw new Error(`Invalid study id "${id}": use a-z, 0-9 and -.`);
  const [config, schema] = await Promise.all([fetchJson(`studies/${id}.json`), fetchJson('studies/schema.json')]);
  const problems = checkStudy(config, schema as Schema);
  if (problems.length) throw new Error(`Study "${id}" is invalid:\n- ${problems.join('\n- ')}`);
  return config as StudyConfig;
}
