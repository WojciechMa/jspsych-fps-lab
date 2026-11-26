// Study configs (public/studies/<id>.json): types, defaults, loading and the checks beyond the
// JSON schema (paradigms and their maps, measures and their parameters, data size against the
// save target's limits).
import { getMeasure, type MeasureSpec } from '../measures/registry';
import { MeasureRunner } from '../measures/runner';
import { IWAD, mapLabel, studyMaps, type WadManifest } from '../paradigms/manifest';
import { getParadigm, type Paradigm, resolveParadigmParams } from '../paradigms/registry';
import { checkSchema, type Schema } from './schema-check';

export type SaveTargetId = 'download' | 'jatos' | 'datapipe';

export interface TrialConfig {
  paradigm?: string;
  map: number;
  skill?: number;
  time_limit: number;
  /** The paradigm's parameters; missing ones take their defaults. */
  params?: Record<string, unknown>;
  /** Seed (uint32) of the paradigm's randomness; left out = drawn per trial at run time. */
  seed?: number;
  no_monsters?: boolean;
  sound?: boolean;
  hud?: boolean;
  automap?: boolean;
  prompt_html?: string;
  measures?: MeasureSpec[];
}

export interface BlockConfig {
  name?: string;
  practice?: boolean;
  instructions_html?: string;
  trials: TrialConfig[];
}

export type QuestionType = 'likert' | 'choice' | 'multi_select' | 'text';

export interface QuestionConfig {
  name: string;
  prompt: string;
  required?: boolean;
  labels?: string[];
  options?: string[];
  horizontal?: boolean;
  rows?: number;
  placeholder?: string;
}

export interface QuestionnaireConfig {
  name?: string;
  type: QuestionType;
  preamble_html?: string;
  questions: QuestionConfig[];
}

export interface StudyConfig {
  title: string;
  content_warning?: string;
  consent_html?: string;
  instructions_html?: string;
  devices?: 'desktop'[];
  fullscreen?: boolean;
  iwad?: 'freedoom2-lab.wad';
  wads?: string[];
  /** "freedoom" (default) or a face id: public/wads/face-<id>.wad from npm run build:face. */
  face?: string;
  url_params?: string[];
  completion_url?: string;
  save: { target: SaveTargetId; datapipe_experiment_id?: string };
  jatos?: { study_uuid: string; component_uuid: string; batch_uuid: string };
  blocks: BlockConfig[];
  questionnaires?: QuestionnaireConfig[];
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
  <p>Before each round you'll read what to do in it. A round ends when you reach its goal, if you
  die, or when its time is up.</p>`;

// JATOS defaults (jatos.resultData.maxSize, jatos.resultFiles.maxSize/studyMaxSize); DataPipe: per request.
export const LIMITS = {
  jatos: { resultData: 5e6, file: 30e6, filesPerRun: 50e6 },
  datapipe: { request: 32e6 },
} as const;

export function trialParadigm(trial: TrialConfig): Paradigm {
  return getParadigm(trial.paradigm ?? 'classic');
}

/** Measure specs of a trial, with the paradigm's defaults when the config lists none. */
export function trialMeasures(trial: TrialConfig): readonly MeasureSpec[] {
  return trial.measures ?? trialParadigm(trial).defaultMeasures;
}

export function allTrials(config: StudyConfig): TrialConfig[] {
  return config.blocks.flatMap((block) => block.trials);
}

/** detect-browser names (via plugin-browser-check) of the supported browsers: Chromium-based or Firefox. */
export const DESKTOP_BROWSERS = ['chrome', 'edge-chromium', 'opera', 'yandexbrowser', 'firefox'];

/** Whether the browser-check results meet the study's device requirements (only "desktop" so far). */
export function meetsDeviceRequirements(features: Record<string, unknown>, config: StudyConfig): boolean {
  return (
    features.mobile === false &&
    features.os !== 'Android OS' &&
    features.os !== 'iOS' &&
    DESKTOP_BROWSERS.includes(String(features.browser)) &&
    features.webaudio === true &&
    (config.fullscreen === false || features.fullscreen === true)
  );
}

// Question fields that only some questionnaire types use.
const QUESTION_FIELDS: Record<QuestionType, { needs?: 'labels' | 'options'; allowed: (keyof QuestionConfig)[] }> = {
  likert: { needs: 'labels', allowed: ['labels'] },
  choice: { needs: 'options', allowed: ['options', 'horizontal'] },
  multi_select: { needs: 'options', allowed: ['options', 'horizontal'] },
  text: { allowed: ['rows', 'placeholder'] },
};
const TYPE_SPECIFIC: (keyof QuestionConfig)[] = ['labels', 'options', 'horizontal', 'rows', 'placeholder'];

function checkQuestionnaires(config: StudyConfig): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  (config.questionnaires ?? []).forEach((page, p) => {
    const rule = QUESTION_FIELDS[page.type];
    page.questions.forEach((question, q) => {
      const path = `config.questionnaires[${p}].questions[${q}]`;
      if (rule.needs && !question[rule.needs]) problems.push(`${path}.${rule.needs} is needed for ${page.type} questions`);
      for (const field of TYPE_SPECIFIC) {
        if (field in question && !rule.allowed.includes(field)) problems.push(`${path}.${field} is not used by ${page.type} questions`);
      }
      if (names.has(question.name)) problems.push(`${path}.name "${question.name}" is used twice`);
      names.add(question.name);
    });
  });
  return problems;
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

/** Each trial's map must suit its paradigm: IWAD levels for classic, the paradigm's own maps otherwise. */
function checkMaps(config: StudyConfig, manifest: WadManifest): string[] {
  const { maps, problems } = studyMaps(config.wads ?? [], manifest);
  if (problems.length) return problems;
  allTrials(config).forEach((trial, i) => {
    const paradigm = trialParadigm(trial);
    const map = maps.get(trial.map);
    const label = mapLabel(trial.map);
    if (paradigm.maps === 'iwad' && map) {
      problems.push(`trial ${i + 1}: ${label} is "${map.name}" from ${map.wad}, a ${map.paradigm} map; set "paradigm": "${map.paradigm}"`);
    }
    if (paradigm.maps === 'iwad' && !map && !IWAD.maps.includes(trial.map)) {
      problems.push(`trial ${i + 1}: ${label} is not in ${IWAD.name} (its levels: ${IWAD.maps.map(mapLabel).join(', ')})`);
    }
    if (paradigm.maps === 'pwad' && map?.paradigm !== paradigm.id) {
      const options = [...maps.values()].filter((m) => m.paradigm === paradigm.id).map((m) => `${mapLabel(m.slot)} ${m.name}`);
      problems.push(
        `trial ${i + 1}: ${paradigm.id} trials need a ${paradigm.id} map from config.wads; ${label} isn't one ` +
          `(available: ${options.join(', ') || 'none'})`,
      );
    }
  });
  return problems;
}

/** Schema check plus everything the schema can't express. Returns all problems found. */
export function checkStudy(config: unknown, schema: Schema, manifest: WadManifest): string[] {
  const problems = checkSchema(config, schema);
  if (problems.length) return problems;
  const study = config as StudyConfig;
  problems.push(...checkQuestionnaires(study));
  problems.push(...checkMaps(study, manifest));
  if (study.face && study.face !== 'freedoom' && study.save.target !== 'jatos') {
    problems.push(`config.face "${study.face}" needs save.target "jatos": faces of real people never go on GitHub Pages`);
  }
  allTrials(study).forEach((trial, i) => {
    const paradigm = trialParadigm(trial);
    try {
      resolveParadigmParams(paradigm, trial.params);
      new MeasureRunner(trialMeasures(trial));
    } catch (error) {
      problems.push(`trial ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (trial.seed !== undefined && paradigm.mode === 0) {
      problems.push(`trial ${i + 1}: ${paradigm.id} trials use no seed; remove "seed"`);
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
): Promise<{ config: StudyConfig; manifest: WadManifest }> {
  if (!STUDY_ID.test(id)) throw new Error(`Invalid study id "${id}": use a-z, 0-9 and -.`);
  const [config, schema, manifest] = await Promise.all([
    fetchJson(`studies/${id}.json`),
    fetchJson('studies/schema.json'),
    fetchJson('wads/manifest.json'),
  ]);
  const problems = checkStudy(config, schema as Schema, manifest as WadManifest);
  if (problems.length) throw new Error(`Study "${id}" is invalid:\n- ${problems.join('\n- ')}`);
  return { config: config as StudyConfig, manifest: manifest as WadManifest };
}
