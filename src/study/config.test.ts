import { describe, expect, it } from 'vitest';
import { splitRecord } from '../save/records';
import { checkStudy, estimateBytes, type StudyConfig } from './config';
import { checkSchema, type Schema } from './schema-check';

const studyFiles = import.meta.glob('../../public/studies/*.json', { eager: true, import: 'default' });
const schema = studyFiles['../../public/studies/schema.json'] as Schema;

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
