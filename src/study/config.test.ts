import { describe, expect, it } from 'vitest';
import { IWAD, mapLabel, type WadManifest } from '../paradigms/manifest';
import { PARADIGMS, resolveParadigmParams } from '../paradigms/registry';
import { splitRecord } from '../save/records';
import { checkStudy as checkStudyWith, estimateBytes, meetsDeviceRequirements, type StudyConfig, trialMeasures } from './config';
import { checkSchema, type Schema } from './schema-check';

const studyFiles = import.meta.glob('../../public/studies/*.json', { eager: true, import: 'default' });
const schema = studyFiles['../../public/studies/schema.json'] as Schema;
const manifest = Object.values(
  import.meta.glob('../../public/wads/manifest.json', { eager: true, import: 'default' }),
)[0] as WadManifest;
const checkStudy = (config: unknown, s: Schema, m: WadManifest = manifest) => checkStudyWith(config, s, m);

const minimal = (): StudyConfig => ({
  title: 'Test',
  save: { target: 'download' },
  blocks: [{ trials: [{ map: 1, time_limit: 60 }] }],
});

describe('study configs', () => {
  const files: string[] = Object.keys(studyFiles).filter((path) => !path.endsWith('/schema.json'));

  it('finds the study configs', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s is valid', (path: string) => {
    expect(/\/[a-z0-9-]+\.json$/.test(path)).toBe(true);
    expect(checkStudy(studyFiles[path], schema)).toEqual([]);
  });

  it('rejects unknown fields, wrong types and out-of-range values', () => {
    const config = { ...minimal(), colour: 'red', blocks: [{ trials: [{ map: 33, time_limit: 901, sound: 'yes' }] }] };
    expect(checkStudy(config, schema)).toEqual([
      'config.colour is not a known field',
      'config.blocks[0].trials[0].map must be at most 32',
      'config.blocks[0].trials[0].time_limit must be at most 900',
      'config.blocks[0].trials[0].sound must be boolean',
    ]);
  });

  it('rejects missing fields and an unsafe completion URL', () => {
    expect(checkStudy({ title: 'x', blocks: [], completion_url: 'javascript:alert(1)' }, schema)).toEqual([
      'config.save is missing',
      'config.completion_url has an invalid format',
      'config.blocks needs at least 1 item(s)',
    ]);
  });

  it('checks measures and their parameters', () => {
    const config = minimal();
    config.blocks[0].trials[0].measures = ['trajectory', { id: 'aiming', params: { nope: 1 } }];
    expect(checkStudy(config, schema)).toEqual(['trial 1: aiming: unknown parameter "nope".']);
    config.blocks[0].trials[0].measures = ['no_such_measure'];
    expect(checkStudy(config, schema)[0]).toMatch(/^trial 1: Unknown measure "no_such_measure"/);
  });

  it('needs JATOS UUIDs for the jatos target and a DataPipe id for datapipe', () => {
    expect(checkStudy({ ...minimal(), save: { target: 'jatos' } }, schema)).toEqual([
      'config.jatos (study, component and batch UUIDs) is needed to save to JATOS',
    ]);
    expect(checkStudy({ ...minimal(), save: { target: 'datapipe' } }, schema)).toEqual([
      'config.save.datapipe_experiment_id is needed to save to DataPipe',
    ]);
  });

  it('allows custom faces only for JATOS studies', () => {
    const uuid = '00000000-0000-4000-8000-000000000000';
    const jatos = { study_uuid: uuid, component_uuid: uuid, batch_uuid: uuid };
    expect(checkStudy({ ...minimal(), face: 'freedoom' }, schema)).toEqual([]);
    expect(checkStudy({ ...minimal(), face: 'lab-a' }, schema)).toEqual([
      'config.face "lab-a" needs save.target "jatos": faces of real people never go on GitHub Pages',
    ]);
    expect(checkStudy({ ...minimal(), face: 'lab-a', save: { target: 'jatos' }, jatos }, schema)).toEqual([]);
    expect(checkStudy({ ...minimal(), face: '../x' }, schema)).toEqual(['config.face has an invalid format']);
  });

  it('checks the estimated data size against JATOS limits', () => {
    const trial = { map: 1, time_limit: 900 };
    const config: StudyConfig = {
      ...minimal(),
      save: { target: 'jatos' },
      jatos: {
        study_uuid: '00000000-0000-0000-0000-000000000001',
        component_uuid: '00000000-0000-0000-0000-000000000002',
        batch_uuid: '00000000-0000-0000-0000-000000000003',
      },
      blocks: [{ trials: Array.from({ length: 40 }, () => trial) }],
    };
    const { total } = estimateBytes(config);
    const problems = checkStudy(config, schema);
    expect(total > 50e6).toBe(problems.some((p) => p.includes('per run')));
  });

  it('checks questionnaire fields per question type and unique answer names', () => {
    const config: StudyConfig = {
      ...minimal(),
      questionnaires: [
        { type: 'likert', questions: [{ name: 'a', prompt: 'A?' }] },
        { type: 'choice', questions: [{ name: 'a', prompt: 'B?', options: ['x', 'y'], labels: ['l', 'm'] }] },
        { type: 'text', questions: [{ name: 'c', prompt: 'C?', rows: 3, placeholder: '' }] },
      ],
    };
    expect(checkStudy(config, schema)).toEqual([
      'config.questionnaires[0].questions[0].labels is needed for likert questions',
      'config.questionnaires[1].questions[0].labels is not used by choice questions',
      'config.questionnaires[1].questions[0].name "a" is used twice',
    ]);
  });
});

describe('paradigms and map WADs', () => {
  const fake: WadManifest = {
    wads: {
      'maze.wad': { bytes: 1, sha256: 'x', source: 'maps/maze.json', maps: [{ slot: 1, name: 'm1', paradigm: 'maze', rois: {} }, { slot: 2, name: 'm2', paradigm: 'maze', rois: {} }] },
      'other.wad': { bytes: 1, sha256: 'y', source: 'maps/other.json', maps: [{ slot: 2, name: 'o2', paradigm: 'maze', rois: {} }] },
    },
  };
  const study = (wads: string[], ...trials: StudyConfig['blocks'][0]['trials']): StudyConfig => ({ ...minimal(), wads, blocks: [{ trials }] });

  it('accepts maze trials on maze maps and classic trials on IWAD slots', () => {
    expect(checkStudy(study(['maze.wad'], { paradigm: 'maze', map: 2, time_limit: 60 }, { map: 6, time_limit: 60 }), schema, fake)).toEqual([]);
  });

  it('rejects classic trials on levels the trimmed IWAD leaves out', () => {
    expect(IWAD.maps).toContain(1);
    expect(checkStudy(study([], { map: 5, time_limit: 60 }), schema, fake)).toEqual([
      `trial 1: MAP05 is not in ${IWAD.name} (its levels: ${IWAD.maps.map(mapLabel).join(', ')})`,
    ]);
  });

  it('rejects maze trials without a maze map and classic trials on replaced slots', () => {
    expect(checkStudy(study([], { paradigm: 'maze', map: 1, time_limit: 60 }), schema, fake)).toEqual([
      "trial 1: maze trials need a maze map from config.wads; MAP01 isn't one (available: none)",
    ]);
    expect(checkStudy(study(['maze.wad'], { map: 1, time_limit: 60 }), schema, fake)).toEqual([
      'trial 1: MAP01 is "m1" from maze.wad, a maze map; set "paradigm": "maze"',
    ]);
  });

  it('rejects unknown WADs, WADs listed twice and slots defined twice', () => {
    expect(checkStudy(study(['nope.wad'], { map: 5, time_limit: 60 }), schema, fake)[0]).toMatch(/^config.wads: nope.wad is not in wads\/manifest.json/);
    expect(checkStudy(study(['maze.wad', 'maze.wad'], { map: 5, time_limit: 60 }), schema, fake)).toContain('config.wads lists a WAD twice');
    expect(checkStudy(study(['maze.wad', 'other.wad'], { map: 5, time_limit: 60 }), schema, fake)).toEqual(['config.wads: other.wad and maze.wad both define MAP02']);
    expect(checkStudy(study(['Maze.WAD'], { map: 5, time_limit: 60 }), schema, fake)).toEqual(['config.wads[0] has an invalid format']);
  });

  it("uses the paradigm's default measures", () => {
    const trialSchema = (schema.$defs as Record<string, { properties: Record<string, { enum: string[] }> }>).trial;
    expect(trialSchema.properties.paradigm.enum).toEqual(PARADIGMS.map((p) => p.id));
    expect(trialMeasures({ map: 1, time_limit: 1 })).toContain('threat_rt');
    expect(trialMeasures({ paradigm: 'maze', map: 1, time_limit: 1 })).toEqual(['session_quality', 'input_log', 'trajectory', 'roi', 'demo']);
  });

  it('has a manifest entry with ROI names for every maze map', () => {
    const maze = manifest.wads['maze.wad'];
    expect(maze.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const map of maze.maps) expect(map).toMatchObject({ paradigm: 'maze', rois: { 900: 'start', 901: 'goal' } });
  });

  it('has spawn spots for every threat-corridor map', () => {
    const corridor = manifest.wads['threat-corridor.wad'];
    for (const map of corridor.maps as (WadManifest['wads'][string]['maps'][number] & { corridor: { pairs: number; spots: { name: string }[] } })[]) {
      expect(map.paradigm).toBe('threat-corridor');
      expect(map.corridor.spots.map((s) => s.name).slice(0, 2)).toEqual(['behind', 'ahead']);
      expect(map.corridor.spots).toHaveLength(2 + 2 * map.corridor.pairs);
    }
  });

  it("checks the paradigm's params and seed", () => {
    const corridor: WadManifest = {
      wads: { 't.wad': { bytes: 1, sha256: 'x', source: 'maps/t.json', maps: [{ slot: 10, name: 't', paradigm: 'threat-corridor', rois: {} }] } },
    };
    const trial = (params: Record<string, unknown>, seed?: number) => ({
      paradigm: 'threat-corridor', map: 10, time_limit: 60, params, ...(seed === undefined ? {} : { seed }),
    });
    expect(checkStudy(study(['t.wad'], trial({ threats: 5, monster: 'imp' }, 7)), schema, corridor)).toEqual([]);
    expect(checkStudy(study(['t.wad'], trial({ threats: 0, colour: 1 })), schema, corridor)).toEqual([
      'trial 1: threat-corridor.threats must be at least 1.',
    ]);
    expect(checkStudy(study(['t.wad'], trial({ colour: 1 })), schema, corridor)).toEqual(['trial 1: threat-corridor: unknown parameter "colour".']);
    expect(checkStudy(study(['t.wad'], trial({ min_delay_s: 4, max_delay_s: 3 })), schema, corridor)).toEqual([
      'trial 1: threat-corridor: min_delay_s must not be larger than max_delay_s.',
    ]);
    expect(checkStudy(study(['t.wad'], trial({}, -1)), schema, corridor)).toEqual(['config.blocks[0].trials[0].seed must be at least 0']);
    expect(checkStudy(study([], { map: 1, time_limit: 60, seed: 3 }), schema, corridor)).toEqual(['trial 1: classic trials use no seed; remove "seed"']);
  });

  it('encodes the threat-corridor params for the engine', () => {
    const paradigm = PARADIGMS.find((p) => p.id === 'threat-corridor')!;
    expect(paradigm.engineParams(resolveParadigmParams(paradigm, { min_delay_s: 1.5, monster: 'demon', attack: true }))).toEqual([10, 53, 175, 3, 1, 1]);
  });

  it('encodes the two-door-bandit params for the engine', () => {
    const paradigm = PARADIGMS.find((p) => p.id === 'two-door-bandit')!;
    expect(paradigm.engineParams(resolveParadigmParams(paradigm, { choices: 30, reversals: [10, 20] }))).toEqual([
      30, 0, 45875, 19661, 1638, 16384, 49152, 35, 1, 10, 20, 0, 0, 0, 0, 0,
    ]);
    expect(paradigm.engineParams(resolveParadigmParams(paradigm, { schedule: 'drifting', p_left: 0.5, p_right: 0.5, feedback_s: 0, show_score: false }))
      .slice(0, 9)).toEqual([40, 1, 32768, 32768, 1638, 16384, 49152, 0, 0]);
  });

  it('checks the two-door-bandit params', () => {
    const paradigm = PARADIGMS.find((p) => p.id === 'two-door-bandit')!;
    const problems = (given: Record<string, unknown>) => {
      try {
        resolveParadigmParams(paradigm, given);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(problems({ reversals: [5, 10, 15, 20, 25, 30, 35] })).toBe('');
    expect(problems({ reversals: [1, 2, 3, 4, 5, 6, 7, 8] })).toMatch(/at most 7/);
    expect(problems({ reversals: [10, 10] })).toMatch(/ascending/);
    expect(problems({ reversals: [40] })).toMatch(/ascending/);
    expect(problems({ schedule: 'drifting', reversals: [3], p_left: 0.5, p_right: 0.5 })).toMatch(/fixed schedule only/);
    expect(problems({ schedule: 'drifting' })).toBe('');
    expect(problems({ schedule: 'drifting', drift_min: 0.4 })).toMatch(/p_right must lie between/);
    expect(problems({ schedule: 'drifting', drift_min: 0.8, drift_max: 0.2 })).toMatch(/drift_min must be smaller/);
  });

  it('has a start and two doors on every two-door-bandit map', () => {
    const wad = manifest.wads['two-door-bandit.wad'];
    expect(wad.maps.length).toBeGreaterThan(0);
    for (const map of wad.maps) expect(map).toMatchObject({ paradigm: 'two-door-bandit', rois: { 900: 'start', 901: 'left', 902: 'right' } });
  });
});

describe('meetsDeviceRequirements', () => {
  const desktop = { mobile: false, os: 'Windows 10', browser: 'chrome', webaudio: true, fullscreen: true };

  it('accepts Chromium-based browsers and Firefox on desktops', () => {
    for (const browser of ['chrome', 'edge-chromium', 'firefox', 'opera']) {
      expect(meetsDeviceRequirements({ ...desktop, browser }, minimal())).toBe(true);
    }
  });

  it('rejects Safari, phones, tablets and missing full screen', () => {
    expect(meetsDeviceRequirements({ ...desktop, browser: 'safari', os: 'Mac OS' }, minimal())).toBe(false);
    expect(meetsDeviceRequirements({ ...desktop, mobile: true }, minimal())).toBe(false);
    expect(meetsDeviceRequirements({ ...desktop, os: 'Android OS' }, minimal())).toBe(false);
    expect(meetsDeviceRequirements({ ...desktop, browser: 'crios', os: 'iOS' }, minimal())).toBe(false);
    expect(meetsDeviceRequirements({ ...desktop, fullscreen: false }, minimal())).toBe(false);
    expect(meetsDeviceRequirements({ ...desktop, fullscreen: false }, { ...minimal(), fullscreen: false })).toBe(true);
  });
});

describe('checkSchema', () => {
  it('refuses keywords it does not implement', () => {
    expect(() => checkSchema('x', { type: 'string', format: 'email' })).toThrow(/Unsupported schema keyword "format"/);
  });

  it('accepts either form of anyOf', () => {
    const s: Schema = { anyOf: [{ type: 'string' }, { type: 'object', required: ['id'] }] };
    expect(checkSchema('a', s)).toEqual([]);
    expect(checkSchema({ id: 'a' }, s)).toEqual([]);
    expect(checkSchema(3, s)).toEqual(["config doesn't match any allowed form"]);
  });
});

describe('splitRecord', () => {
  it('moves raw outputs into files and keeps summaries', () => {
    const record = {
      trial_index: 4,
      trial_type: 'doom-trial',
      results: {
        trajectory: { summary: { path_length: 10 }, raw: { x: [1, 2] } },
        demo: { summary: { bytes: 3 }, raw: btoa('\x01\x02\x03') },
        aiming: { error: 'boom' },
      },
    };
    const { compact, files } = splitRecord(record);
    expect(files.map((f) => f.name)).toEqual(['trial-004-trajectory.json', 'trial-004-demo.lmp']);
    expect(files[0].content).toBe('{"x":[1,2]}');
    expect(Array.from(files[1].content as Uint8Array)).toEqual([1, 2, 3]);
    expect(compact.results).toEqual({
      trajectory: { summary: { path_length: 10 }, raw_file: 'trial-004-trajectory.json' },
      demo: { summary: { bytes: 3 }, raw_file: 'trial-004-demo.lmp' },
      aiming: { error: 'boom' },
    });
    expect(record.results.trajectory.raw).toEqual({ x: [1, 2] });
  });

  it('leaves records without results unchanged', () => {
    const record = { trial_index: 0, response: 1 };
    expect(splitRecord(record)).toEqual({ compact: record, files: [] });
  });
});
