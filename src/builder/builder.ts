// Study builder (builder.html): edit a study config, check it with the same checks as the study
// page, preview what participants see and the data size, and export the JSON to commit.
import { MEASURES, resolveParams } from '../measures/registry';
import type { ParamSchema } from '../measures/types';
import { CONSENT_TEXT } from '../save/targets';
import {
  checkStudy,
  DEFAULT_CONTENT_WARNING,
  DEFAULT_INSTRUCTIONS_HTML,
  estimateBytes,
  fetchJson,
  LIMITS,
  type QuestionnaireConfig,
  type QuestionType,
  STUDY_ID,
  type SaveTargetId,
  type StudyConfig,
} from '../study/config';
import { consentHtml, escapeHtml, warningHtml } from '../study/pages';
import { checkSchema, type Schema } from '../study/schema-check';
import { blankDraft, defaultMeasures, type Draft, fromConfig, newQuestion, newTrial, toConfig } from './draft';
import './builder.css';

const STORAGE_KEY = 'jspsych-fps-lab-builder-draft';

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

let schema: Schema;
let draft: Draft = restoreDraft();
let loadNote: string | null = null;

function restoreDraft(): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Draft> | null;
    if (saved && Array.isArray(saved.blocks)) {
      return { ...blankDraft(), ...saved, measures: { ...defaultMeasures(), ...saved.measures } };
    }
  } catch {
    // A broken draft falls back to a blank one.
  }
  return blankDraft();
}

const formEl = el('div', { className: 'form' });
const problemsEl = el('div');
const sizeEl = el('div');
const pagesEl = el('iframe', { className: 'pages', title: 'Participant screens' });
pagesEl.setAttribute('sandbox', '');
const outputEl = el('textarea', { readOnly: true, rows: 16, spellcheck: false });
const downloadButton = el('button', { type: 'button', textContent: 'Download', onclick: downloadConfig });
const copyButton = el('button', {
  type: 'button',
  textContent: 'Copy',
  onclick: () => void navigator.clipboard.writeText(outputEl.value),
});
const nextStepsEl = el('p', { className: 'help' });
const noteEl = el('p', { className: 'note' });

// --- Form controls bound to the draft ---

function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  return el('label', { className: 'field' }, el('span', { textContent: label }), control, ...(help ? [el('small', { textContent: help })] : []));
}

function textInput(value: string, set: (value: string) => void, props: Props<'input'> = {}): HTMLInputElement {
  return el('input', {
    type: 'text',
    value,
    oninput: (event) => {
      set((event.target as HTMLInputElement).value);
      update();
    },
    ...props,
  });
}

function textArea(value: string, set: (value: string) => void, props: Props<'textarea'> = {}): HTMLTextAreaElement {
  return el('textarea', {
    value,
    rows: 3,
    oninput: (event) => {
      set((event.target as HTMLTextAreaElement).value);
      update();
    },
    ...props,
  });
}

function numberInput(value: number, set: (value: number) => void, props: Props<'input'> = {}): HTMLInputElement {
  return el('input', {
    type: 'number',
    value: Number.isFinite(value) ? String(value) : '',
    oninput: (event) => {
      set((event.target as HTMLInputElement).valueAsNumber);
      update();
    },
    ...props,
  });
}

function checkbox(checked: boolean, set: (checked: boolean) => void): HTMLInputElement {
  return el('input', {
    type: 'checkbox',
    checked,
    onchange: (event) => {
      set((event.target as HTMLInputElement).checked);
      update();
    },
  });
}

function select(options: [string, string][], value: string, set: (value: string) => void, rerender = false): HTMLSelectElement {
  const node = el(
    'select',
    {
      onchange: (event) => {
        set((event.target as HTMLSelectElement).value);
        if (rerender) renderForm();
        update();
      },
    },
    ...options.map(([optionValue, label]) => el('option', { value: optionValue, textContent: label })),
  );
  node.value = value;
  return node;
}

function button(label: string, onclick: () => void, disabled = false): HTMLButtonElement {
  return el('button', {
    type: 'button',
    textContent: label,
    disabled,
    onclick: () => {
      onclick();
      renderForm();
      update();
    },
  });
}

function paramInput(schema: ParamSchema, value: unknown, set: (value: unknown) => void): HTMLElement {
  switch (schema.type) {
    case 'number':
    case 'integer':
      return numberInput(value as number, set, {
        step: schema.type === 'integer' ? '1' : 'any',
        ...(schema.minimum !== undefined ? { min: String(schema.minimum) } : {}),
        ...(schema.maximum !== undefined ? { max: String(schema.maximum) } : {}),
      });
    case 'boolean':
      return checkbox(value as boolean, set);
    case 'string':
      return select(schema.enum.map((option) => [option, option]), value as string, set);
    case 'array':
      return textInput((value as number[]).join(', '), (text) =>
        set(text.split(/[\s,]+/).filter(Boolean).map(Number)),
      );
  }
}

// --- Form sections ---

function studySection(): HTMLElement {
  return el(
    'fieldset',
    {},
    el('legend', { textContent: 'Study' }),
    field('Study id', textInput(draft.id, (v) => (draft.id = v), { pattern: '[a-z0-9\\-]+' }), 'File name without .json: a-z, 0-9 and -. Participants open it as ?study=<id>.'),
    field('Title', textInput(draft.title, (v) => (draft.title = v)), 'Heading of the consent page and the browser tab.'),
    field('Content warning', textArea(draft.content_warning, (v) => (draft.content_warning = v), { placeholder: DEFAULT_CONTENT_WARNING, rows: 4 }), 'Plain text of the first screen. Empty: the default text shown in grey.'),
    field('Consent text (HTML)', textArea(draft.consent_html, (v) => (draft.consent_html = v), { rows: 5 }), 'Your study information. The list of recorded data and where it goes is added below it.'),
    field('Instructions (HTML)', textArea(draft.instructions_html, (v) => (draft.instructions_html = v), { placeholder: DEFAULT_INSTRUCTIONS_HTML.trim(), rows: 4 }), 'Shown after consent. Empty: the game controls (shown in grey).'),
    el('label', {}, checkbox(draft.fullscreen, (v) => (draft.fullscreen = v)), ' Full screen (recommended): asked before the instructions; leaving it pauses the game'),
    field('URL parameters to store', textInput(draft.url_params, (v) => (draft.url_params = v), { placeholder: 'e.g. participant, session' }), 'Names of query parameters (e.g. a participant code from the recruitment platform) stored with the data.'),
    field('Completion URL', textInput(draft.completion_url, (v) => (draft.completion_url = v), { placeholder: 'https://…' }), 'Optional: where participants go after finishing, e.g. back to the recruitment platform.'),
    el('p', { className: 'help', textContent: 'Game data: Freedoom Phase 2. Status-bar face: Freedoom\'s. Paradigm: classic Doom. More choices come with M4.' }),
  );
}

function saveSection(): HTMLElement {
  const targets: [SaveTargetId, string][] = [
    ['download', 'Download only (participants keep a file; nothing is sent)'],
    ['jatos', 'JATOS (the lab server)'],
    ['datapipe', 'DataPipe (not implemented yet)'],
  ];
  const section = el(
    'fieldset',
    {},
    el('legend', { textContent: 'Where the data goes' }),
    field('Save target', select(targets, draft.target, (v) => (draft.target = v as SaveTargetId), true)),
  );
  if (draft.target === 'jatos') {
    const uuid = (key: keyof Draft['jatos'], label: string) =>
      field(label, textInput(draft.jatos[key], (v) => (draft.jatos[key] = v.trim())));
    section.append(
      uuid('study_uuid', 'JATOS study UUID'),
      uuid('component_uuid', 'Component UUID'),
      uuid('batch_uuid', 'Batch UUID'),
      el(
        'div',
        { className: 'row' },
        button('Generate new UUIDs', () => {
          draft.jatos = { study_uuid: crypto.randomUUID(), component_uuid: crypto.randomUUID(), batch_uuid: crypto.randomUUID() };
        }),
        el('small', { className: 'help', textContent: 'Generate once per study and keep them: re-importing with the same UUIDs updates the study in JATOS and keeps its results. Never copy another study\'s UUIDs.' }),
      ),
    );
  }
  if (draft.target === 'datapipe') {
    section.append(field('DataPipe experiment id', textInput(draft.datapipe_experiment_id, (v) => (draft.datapipe_experiment_id = v.trim()))));
  }
  return section;
}

function measuresSection(): HTMLElement {
  const section = el(
    'fieldset',
    {},
    el('legend', { textContent: 'Measures (all trials)' }),
    el('p', { className: 'help', textContent: 'Only the ticked measures are recorded, and the consent page lists exactly these.' }),
  );
  for (const measure of MEASURES) {
    const choice = draft.measures[measure.id];
    const params = el('div', { className: 'params' });
    for (const [name, schema] of Object.entries(measure.paramsSchema.properties)) {
      params.append(
        el('span', { textContent: name, title: schema.description }),
        el('span', {}, paramInput(schema, choice.params[name], (value) => (choice.params[name] = value)), el('small', { textContent: ` ${schema.description}` })),
      );
    }
    section.append(
      el(
        'div',
        { className: 'measure' },
        el('label', {}, checkbox(choice.on, (on) => (choice.on = on)), ` ${measure.label} `, el('small', { textContent: `${measure.id} ${measure.version}` })),
        el('small', { className: 'help', textContent: measure.participantDescription }),
        el('details', {}, el('summary', { textContent: 'Parameters' }), params, button('Reset to defaults', () => (choice.params = resolveParams(measure)))),
      ),
    );
  }
  return section;
}

function blocksSection(): HTMLElement {
  const section = el('fieldset', {}, el('legend', { textContent: 'Blocks and trials' }));
  const maps: [string, string][] = Array.from({ length: 32 }, (_, i) => [String(i + 1), `MAP${String(i + 1).padStart(2, '0')}`]);
  const skills: [string, string][] = [1, 2, 3, 4, 5].map((n) => [String(n), n === 3 ? '3 (default)' : String(n)]);
  draft.blocks.forEach((block, b) => {
    const rows = block.trials.map((trial, t) =>
      el(
        'tr',
        {},
        el('td', { textContent: String(t + 1) }),
        el('td', {}, select(maps, String(trial.map), (v) => (trial.map = Number(v)))),
        el('td', {}, select(skills, String(trial.skill ?? 3), (v) => (trial.skill = Number(v)))),
        el('td', {}, numberInput(trial.time_limit, (v) => (trial.time_limit = v), { min: '1', max: '900', step: '1' })),
        el('td', {}, checkbox(trial.no_monsters ?? false, (v) => (trial.no_monsters = v))),
        el('td', {}, checkbox(trial.sound ?? true, (v) => (trial.sound = v))),
        el('td', {}, checkbox(trial.hud ?? true, (v) => (trial.hud = v))),
        el('td', {}, checkbox(trial.automap ?? false, (v) => (trial.automap = v))),
        el('td', {}, textInput(trial.prompt_html ?? '', (v) => (trial.prompt_html = v), { placeholder: 'Click to start.' })),
        el(
          'td',
          { className: 'row' },
          button('Copy', () => block.trials.splice(t + 1, 0, structuredClone(trial))),
          button('Remove', () => block.trials.splice(t, 1), block.trials.length === 1),
        ),
      ),
    );
    const header = ['#', 'Map', 'Skill', 'Time limit (s)', 'No monsters', 'Sound', 'Status bar', 'Automap (Tab)', 'Prompt (HTML)', ''];
    section.append(
      el(
        'div',
        { className: 'block' },
        el('h3', { textContent: `Block ${b + 1}` }),
        field('Name (optional, stored with the data)', textInput(block.name ?? '', (v) => (block.name = v))),
        el('label', {}, checkbox(block.practice ?? false, (v) => (block.practice = v)), ' Practice block (its trials are marked practice in the data)'),
        field('Instructions before the block (HTML, optional)', textArea(block.instructions_html ?? '', (v) => (block.instructions_html = v), { rows: 2 })),
        el('table', { className: 'trials' }, el('tr', {}, ...header.map((h) => el('th', { textContent: h }))), ...rows),
        el(
          'div',
          { className: 'row' },
          button('Add trial', () => block.trials.push(newTrial())),
          button('Remove block', () => draft.blocks.splice(b, 1), draft.blocks.length === 1),
        ),
      ),
    );
  });
  section.append(
    button('Add block', () => draft.blocks.push({ trials: [newTrial()] })),
    el('p', { className: 'help', textContent: 'Time limits count game time, so pauses don\'t count; at most 900 s (15 min) per trial.' }),
  );
  return section;
}

const QUESTION_TYPES: [QuestionType, string][] = [
  ['likert', 'Rating scale (Likert)'],
  ['choice', 'Pick one option'],
  ['multi_select', 'Pick any options'],
  ['text', 'Typed answer'],
];

function questionnairesSection(): HTMLElement {
  const section = el(
    'fieldset',
    {},
    el('legend', { textContent: 'Questionnaires' }),
    el('p', { className: 'help', textContent: 'Pages of questions after the last block. Each page has one question type. Answer names must be unique in the study; they become the keys of the answers in the data.' }),
  );
  const lines = (values: string[] | undefined) => (values ?? []).join('\n');
  const split = (text: string) => text.split('\n');
  draft.questionnaires.forEach((page, p) => {
    const questions = page.questions.map((q, i) => {
      const specific: HTMLElement[] =
        page.type === 'likert'
          ? [field('Scale labels, lowest first (one per line; stored as 0, 1, …)', textArea(lines(q.labels), (v) => (q.labels = split(v)), { rows: 5 }))]
          : page.type === 'text'
            ? [
                field('Answer box height (lines)', numberInput(q.rows ?? 1, (v) => (q.rows = v), { min: '1', max: '20', step: '1' })),
                field('Placeholder', textInput(q.placeholder ?? '', (v) => (q.placeholder = v))),
              ]
            : [
                field('Options (one per line)', textArea(lines(q.options), (v) => (q.options = split(v)), { rows: 4 })),
                el('label', {}, checkbox(q.horizontal ?? false, (v) => (q.horizontal = v)), ' Options in one row'),
              ];
      return el(
        'div',
        { className: 'question' },
        field(`Question ${i + 1} (HTML)`, textArea(q.prompt, (v) => (q.prompt = v), { rows: 2 })),
        el(
          'div',
          { className: 'row' },
          field('Answer name', textInput(q.name, (v) => (q.name = v.trim()), { pattern: '[A-Za-z0-9_]{1,64}', size: 16 })),
          el('label', {}, checkbox(q.required ?? false, (v) => (q.required = v)), ' Required'),
          button('Remove question', () => page.questions.splice(i, 1), page.questions.length === 1),
        ),
        ...specific,
      );
    });
    section.append(
      el(
        'div',
        { className: 'block' },
        el('h3', { textContent: `Page ${p + 1}` }),
        el(
          'div',
          { className: 'row' },
          field('Type', select(QUESTION_TYPES, page.type, (v) => {
            page.type = v as QuestionType;
            const defaults = newQuestion(0);
            for (const q of page.questions) {
              q.labels ??= defaults.labels;
              q.options ??= defaults.options;
            }
          }, true)),
          field('Name (optional, stored with the answers)', textInput(page.name ?? '', (v) => (page.name = v.trim()), { pattern: '[A-Za-z0-9_]{1,64}', size: 16 })),
        ),
        field('Text above the questions (HTML, optional)', textArea(page.preamble_html ?? '', (v) => (page.preamble_html = v), { rows: 2 })),
        ...questions,
        el(
          'div',
          { className: 'row' },
          button('Add question', () => page.questions.push(newQuestion(questionCount() + 1))),
          button('Remove page', () => draft.questionnaires.splice(p, 1)),
        ),
      ),
    );
  });
  section.append(button('Add questionnaire page', () => draft.questionnaires.push({ type: 'likert', questions: [newQuestion(questionCount() + 1)] })));
  return section;
}

function questionCount(): number {
  return draft.questionnaires.reduce((sum, page) => sum + page.questions.length, 0);
}

function renderForm(): void {
  noteEl.textContent = loadNote ?? '';
  formEl.replaceChildren(studySection(), saveSection(), measuresSection(), blocksSection(), questionnairesSection());
}

// --- Checks, preview and export ---

function megabytes(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(bytes / 1e3)} kB`;
}

function renderSize(config: StudyConfig): void {
  const { perTrialMeasure, total } = estimateBytes(config);
  let index = 0;
  const rows = config.blocks.flatMap((block, b) =>
    block.trials.map((trial, t) => {
      const bytes = perTrialMeasure[index++].reduce((sum, n) => sum + n, 0);
      return el(
        'tr',
        {},
        ...[`${b + 1}`, `${t + 1}`, `MAP${String(trial.map).padStart(2, '0')}`, `${trial.time_limit} s`, megabytes(bytes)].map((text) => el('td', { textContent: text })),
      );
    }),
  );
  const limits =
    config.save.target === 'jatos'
      ? `JATOS default limits: ${megabytes(LIMITS.jatos.file)} per file (largest here: ${megabytes(Math.max(...perTrialMeasure.flat()))}), ${megabytes(LIMITS.jatos.filesPerRun)} of files per session (here: ${megabytes(total)}).`
      : config.save.target === 'datapipe'
        ? `DataPipe limit: ${megabytes(LIMITS.datapipe.request)} per request (one trial).`
        : 'The download holds everything in one file.';
  sizeEl.replaceChildren(
    el('table', {}, el('tr', {}, ...['Block', 'Trial', 'Map', 'Time limit', 'Data'].map((h) => el('th', { textContent: h }))), ...rows),
    el('p', { textContent: `Total: about ${megabytes(total)} if every trial runs to its time limit. ${limits}` }),
  );
}

const PREVIEW_STYLE = `
  body { margin: 0; padding: 0 1em; background: #000; color: #ddd; font: 16px/1.4 system-ui, sans-serif; text-align: center; }
  section { padding: 1em 0 1.5em; border-bottom: 2px dashed #444; }
  .recorded { display: inline-block; max-width: 48em; margin: 0; text-align: left; }
  .buttons span { display: inline-block; margin: 0.2em; padding: 0.4em 0.9em; border: 1px solid #555; border-radius: 4px; background: #222; }
  .label { color: #888; font-size: 12px; text-transform: uppercase; }
  .question { max-width: 48em; margin: 1em auto; text-align: left; }
  .answer { color: #aaa; }`;

function questionnairePreview(page: QuestionnaireConfig): string {
  const questions = page.questions.map((q) => {
    const answer =
      page.type === 'likert'
        ? (q.labels ?? []).map((label) => `○ ${escapeHtml(label)}`).join(' &nbsp; ')
        : page.type === 'text'
          ? `[${escapeHtml(q.placeholder || 'typed answer')}]`
          : (q.options ?? []).map((option) => `${page.type === 'choice' ? '○' : '☐'} ${escapeHtml(option)}`).join(q.horizontal ? ' &nbsp; ' : '<br>');
    return `<div class="question"><div>${q.prompt}${q.required ? ' *' : ''}</div><div class="answer">${answer}</div></div>`;
  });
  return `${page.preamble_html ?? ''}${questions.join('')}`;
}

function renderPages(config: StudyConfig): void {
  const page = (label: string, html: string, buttons: string[]) =>
    `<section><div class="label">${escapeHtml(label)}</div>${html}<p class="buttons">${buttons.map((b) => `<span>${escapeHtml(b)}</span>`).join('')}</p></section>`;
  const consentText = CONSENT_TEXT[config.save.target] ?? '(DataPipe is not implemented yet: no text.)';
  const blocks = config.blocks.flatMap((block, b) => [
    ...(block.instructions_html ? [page(`Before block ${b + 1}`, block.instructions_html, ['Continue'])] : []),
    ...block.trials.map((trial, t) =>
      page(`${block.practice ? 'Practice b' : 'B'}lock ${b + 1}, trial ${t + 1}: MAP${String(trial.map).padStart(2, '0')}, up to ${trial.time_limit} s`, `<p>${trial.prompt_html ?? 'Click to start.'}</p>`, []),
    ),
  ]);
  const questionnaires = (config.questionnaires ?? []).map((q, p) => page(`Questionnaire page ${p + 1}`, questionnairePreview(q), ['Continue']));
  const fullscreen = config.fullscreen ?? true;
  const uploads = config.save.target !== 'download';
  pagesEl.srcdoc = `<!doctype html><meta charset="utf-8"><style>${PREVIEW_STYLE}</style>${[
    page('Content warning', warningHtml(config), ['Continue', "I'd rather not take part"]),
    page('Consent', consentHtml(config, consentText), ['I agree', 'I do not agree']),
    page('Browser check', '<p>Automatic. Phones, tablets and browsers other than Chrome, Edge, Firefox or Opera end the study here, with nothing recorded.</p>', []),
    ...(fullscreen ? [page('Full screen', '<p>The game is played in full screen. Leaving full screen pauses it.</p>', ['Switch to full screen'])] : []),
    page('Instructions', config.instructions_html ?? DEFAULT_INSTRUCTIONS_HTML, ['Continue']),
    ...blocks,
    ...questionnaires,
    page('End', '<h1>Your data</h1><p>A table of the recorded rounds and their data size.</p>', uploads ? ['Submit my data', 'Download a copy', 'Withdraw and delete my data'] : ['Finish', 'Download my data']),
  ].join('')}`;
}

function update(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  const config = toConfig(draft);
  const problems = [
    ...(STUDY_ID.test(draft.id) ? [] : ['Study id: use only a-z, 0-9 and -.']),
    ...(Object.values(draft.measures).some((choice) => choice.on) ? [] : ['Tick at least one measure.']),
    ...checkStudy(config, schema),
  ];
  problemsEl.replaceChildren(
    problems.length
      ? el('ul', { className: 'problems' }, ...problems.map((problem) => el('li', { textContent: problem })))
      : el('p', { className: 'ok', textContent: 'No problems found.' }),
  );
  if (checkSchema(config, schema).length === 0) {
    renderSize(config);
    renderPages(config);
  } else {
    sizeEl.replaceChildren(el('p', { className: 'help', textContent: 'Fix the problems above to see the estimate.' }));
  }
  outputEl.value = `${JSON.stringify(config, null, 2)}\n`;
  downloadButton.disabled = copyButton.disabled = problems.length > 0;
  nextStepsEl.textContent =
    `Save it as public/studies/${draft.id}.json, commit it, and test it with ?study=${draft.id} (npm run dev). ` +
    (draft.target === 'jatos'
      ? `Then deploy it with the "Deploy study to JATOS" workflow (study id ${draft.id}), or pack it with npm run build:jatos -- ${draft.id} and import it.`
      : 'Download-only studies can run on GitHub Pages.');
}

function downloadConfig(): void {
  const url = URL.createObjectURL(new Blob([outputEl.value], { type: 'application/json' }));
  el('a', { href: url, download: `${draft.id}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function load(config: unknown, id: string): void {
  const problems = checkSchema(config, schema);
  if (problems.length) throw new Error(`This is not a valid study config:\n- ${problems.join('\n- ')}`);
  const loaded = fromConfig(config as StudyConfig, id);
  draft = loaded.draft;
  loadNote = loaded.note;
  renderForm();
  update();
}

function reportLoadError(error: unknown): void {
  alert(error instanceof Error ? error.message : String(error));
}

function header(): HTMLElement {
  const fileInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        load(JSON.parse(await file.text()), file.name.replace(/\.json$/i, '').toLowerCase());
      } catch (error) {
        reportLoadError(error);
      }
    },
  });
  const siteId = el('input', { type: 'text', value: 'demo', size: 12, ariaLabel: 'Study id on this site' });
  return el(
    'header',
    {},
    el('h1', { textContent: 'Study builder' }),
    el('p', { textContent: 'Fill in a study, check what participants will see and how much data it records, then export the JSON file. Nothing is sent anywhere; the draft is kept in this browser.' }),
    el(
      'div',
      { className: 'row' },
      el('button', {
        type: 'button',
        textContent: 'New study',
        onclick: () => {
          if (!confirm('Discard the current draft?')) return;
          draft = blankDraft();
          loadNote = null;
          renderForm();
          update();
        },
      }),
      el('button', { type: 'button', textContent: 'Open a file…', onclick: () => fileInput.click() }),
      fileInput,
      el('span', { className: 'help', textContent: 'or load studies/' }),
      siteId,
      el('span', { className: 'help', textContent: '.json' }),
      el('button', {
        type: 'button',
        textContent: 'Load',
        onclick: async () => {
          const id = siteId.value.trim();
          try {
            if (!STUDY_ID.test(id)) throw new Error('Use a-z, 0-9 and - only.');
            load(await fetchJson(`studies/${id}.json`), id);
          } catch (error) {
            reportLoadError(error);
          }
        },
      }),
    ),
    noteEl,
  );
}

async function start(): Promise<void> {
  schema = (await fetchJson('studies/schema.json')) as Schema;
  document.body.append(
    header(),
    el(
      'main',
      {},
      formEl,
      el(
        'div',
        { className: 'preview' },
        el('h2', { textContent: 'Problems' }),
        problemsEl,
        el('h2', { textContent: 'Estimated data size' }),
        sizeEl,
        el('h2', { textContent: 'What participants see' }),
        pagesEl,
        el('h2', { textContent: 'Study config' }),
        outputEl,
        el('div', { className: 'row' }, downloadButton, copyButton),
        nextStepsEl,
      ),
    ),
  );
  renderForm();
  update();
}

start().catch((error: unknown) => {
  document.body.append(el('pre', { className: 'problems', textContent: `Could not start: ${error instanceof Error ? error.message : String(error)}` }));
});
