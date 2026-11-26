import { describe, expect, it } from 'vitest';
import { getParadigm } from '../paradigms/registry';
import type { StudyConfig } from '../study/config';
import { blankDraft, defaultMeasures, fromConfig, measureSpecs, newQuestion, toConfig } from './draft';

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
    expect(toConfig(draft).blocks[0].trials[0]).toEqual({ map: 1, skill: 3, time_limit: 300 });

    draft.measures.demo.on = false;
    draft.measures.aiming.params = { ...draft.measures.aiming.params, targetMaxOffsetDeg: 10 };
    const specs = measureSpecs(draft);
    expect(specs).not.toContain('demo');
    expect(specs).toContainEqual({ id: 'aiming', params: { targetMaxOffsetDeg: 10 } });
    expect(toConfig(draft).blocks[0].trials[0].measures).toEqual(specs);
  });

  it("compares the measures with each trial's paradigm defaults", () => {
    const draft = blankDraft();
    draft.wads = ['maze.wad'];
    draft.blocks[0].trials = [{ paradigm: 'maze', map: 2, skill: 3, time_limit: 60 }, { paradigm: 'classic', map: 7, skill: 3, time_limit: 60 }];
    draft.measures = defaultMeasures(getParadigm('maze').defaultMeasures);
    const config = toConfig(draft);
    expect(config.wads).toEqual(['maze.wad']);
    expect(config.blocks[0].trials[0]).toEqual({ paradigm: 'maze', map: 2, skill: 3, time_limit: 60 });
    expect(config.blocks[0].trials[1]).toEqual({ map: 7, skill: 3, time_limit: 60, measures: getParadigm('maze').defaultMeasures });
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

  it('round-trips practice blocks, full screen and questionnaires', () => {
    const config: StudyConfig = {
      title: 'x',
      fullscreen: false,
      save: { target: 'download' },
      blocks: [
        { name: 'warm-up', practice: true, trials: [{ map: 2, skill: 3, time_limit: 30 }] },
        { trials: [{ map: 1, skill: 3, time_limit: 60, hud: false, automap: true }] },
      ],
      questionnaires: [
        { name: 'p1', type: 'choice', preamble_html: '<p>Hi</p>', questions: [{ name: 'a', prompt: 'A?', required: true, options: ['x', 'y'], horizontal: true }] },
        { type: 'text', questions: [{ name: 'b', prompt: 'B?', rows: 3, placeholder: 'type' }] },
      ],
    };
    expect(toConfig(fromConfig(config, 'x').draft)).toEqual({ $schema: './schema.json', ...config });
  });

  it('keeps only the fields of the page type', () => {
    const draft = blankDraft();
    draft.questionnaires = [{ type: 'likert', questions: [newQuestion(1)] }];
    expect(toConfig(draft).questionnaires).toEqual([
      { type: 'likert', questions: [{ name: 'q1', prompt: '', labels: newQuestion(1).labels }] },
    ]);
    draft.questionnaires[0].type = 'multi_select';
    draft.questionnaires[0].questions[0].options = ['a', ' ', 'b '];
    expect(toConfig(draft).questionnaires?.[0].questions[0]).toEqual({ name: 'q1', prompt: '', options: ['a', 'b'] });
  });

  it('writes the JATOS UUIDs only for the jatos target', () => {
    const draft = blankDraft();
    draft.jatos = { study_uuid: 'a', component_uuid: 'b', batch_uuid: 'c' };
    expect(toConfig(draft).jatos).toBeUndefined();
    draft.target = 'jatos';
    expect(toConfig(draft).jatos).toEqual({ study_uuid: 'a', component_uuid: 'b', batch_uuid: 'c' });
  });
});
