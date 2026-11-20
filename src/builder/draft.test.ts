import { describe, expect, it } from 'vitest';
import type { StudyConfig } from '../study/config';
import { blankDraft, fromConfig, measureSpecs, toConfig } from './draft';

const studyFiles = import.meta.glob('../../public/studies/*.json', { eager: true, import: 'default' });

describe('builder draft', () => {
  const files = Object.keys(studyFiles).filter((path) => !path.endsWith('/schema.json'));

  it.each(files)('%s survives a round trip unchanged', (path: string) => {
    const config = studyFiles[path] as StudyConfig;
    const { draft, note } = fromConfig(config, 'x');
    expect(note).toBeNull();
    expect(toConfig(draft)).toEqual(config);
  });

  it('leaves out default measures and writes only changed parameters', () => {
    const draft = blankDraft();
    expect(measureSpecs(draft)).toBeUndefined();
    expect(toConfig(draft).blocks[0].trials[0]).toEqual({ map: 1, skill: 3, time_limit: 300 });

    draft.measures.demo.on = false;
    draft.measures.aiming.params = { ...draft.measures.aiming.params, targetMaxOffsetDeg: 10 };
    const specs = measureSpecs(draft);
    expect(specs).not.toContain('demo');
    expect(specs).toContainEqual({ id: 'aiming', params: { targetMaxOffsetDeg: 10 } });
  });

  it('notes trials with different measures and keeps the first trial\'s', () => {
    const config: StudyConfig = {
      title: 'x',
      save: { target: 'download' },
      blocks: [{ trials: [{ map: 1, time_limit: 60, measures: ['trajectory'] }, { map: 2, time_limit: 60 }] }],
    };
    const { draft, note } = fromConfig(config, 'x');
    expect(note).toMatch(/different measures/);
    expect(measureSpecs(draft)).toEqual(['trajectory']);
  });

  it('writes the JATOS UUIDs only for the jatos target', () => {
    const draft = blankDraft();
    draft.jatos = { study_uuid: 'a', component_uuid: 'b', batch_uuid: 'c' };
    expect(toConfig(draft).jatos).toBeUndefined();
    draft.target = 'jatos';
    expect(toConfig(draft).jatos).toEqual({ study_uuid: 'a', component_uuid: 'b', batch_uuid: 'c' });
  });
});
