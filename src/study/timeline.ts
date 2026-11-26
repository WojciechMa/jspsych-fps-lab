// Builds a study's jsPsych timeline from its config: content warning → consent → browser check →
// full screen → instructions → blocks of Doom trials (each followed by a save step) →
// questionnaires → "your data" → submit, download or withdraw.
import BrowserCheckPlugin from '@jspsych/plugin-browser-check';
import FullscreenPlugin from '@jspsych/plugin-fullscreen';
import HtmlButtonResponsePlugin from '@jspsych/plugin-html-button-response';
import SurveyLikertPlugin from '@jspsych/plugin-survey-likert';
import SurveyMultiChoicePlugin from '@jspsych/plugin-survey-multi-choice';
import SurveyMultiSelectPlugin from '@jspsych/plugin-survey-multi-select';
import SurveyTextPlugin from '@jspsych/plugin-survey-text';
import type { JsPsych } from 'jspsych';
import DoomTrialPlugin from '../plugins/plugin-doom-trial';
import SaveStepPlugin from '../plugins/plugin-save-step';
import { mapLabel, studyMaps, type WadManifest } from '../paradigms/manifest';
import type { SaveTarget } from '../save/targets';
import {
  DEFAULT_INSTRUCTIONS_HTML,
  meetsDeviceRequirements,
  type QuestionnaireConfig,
  type StudyConfig,
  trialMeasures,
  trialParadigm,
} from './config';
import { consentHtml, escapeHtml, warningHtml } from './pages';

// jsPsych doesn't export its TimelineArray type.
type Timeline = Extract<Parameters<JsPsych['run']>[0], unknown[]>;

export interface Session {
  /** Set when the participant declines the warning or consent, is excluded by the browser check, or withdraws. */
  ended: 'declined' | 'excluded' | 'withdrawn' | null;
}

function questionnaireTrial(page: QuestionnaireConfig) {
  const common = { preamble: page.preamble_html ?? '', data: { screen: 'questionnaire', questionnaire: page.name ?? null } };
  const base = page.questions.map((q) => ({ name: q.name, prompt: q.prompt, required: q.required ?? false }));
  switch (page.type) {
    case 'likert':
      return { ...common, type: SurveyLikertPlugin, questions: base.map((q, i) => ({ ...q, labels: page.questions[i].labels })) };
    case 'choice':
    case 'multi_select':
      return {
        ...common,
        type: page.type === 'choice' ? SurveyMultiChoicePlugin : SurveyMultiSelectPlugin,
        questions: base.map((q, i) => ({ ...q, options: page.questions[i].options, horizontal: page.questions[i].horizontal ?? false })),
      };
    case 'text':
      return {
        ...common,
        type: SurveyTextPlugin,
        questions: base.map((q, i) => ({ ...q, rows: page.questions[i].rows ?? 1, placeholder: page.questions[i].placeholder ?? '' })),
      };
  }
}

export function buildTimeline(
  jsPsych: JsPsych,
  config: StudyConfig,
  manifest: WadManifest,
  target: SaveTarget,
  fileName: () => string,
): { timeline: Timeline; session: Session } {
  const session: Session = { ended: null };
  const { maps } = studyMaps(config.wads ?? [], manifest);
  let sent = 0;
  // Sends records one by one, so a retry after a failure doesn't send any record twice.
  const sendNew = async (): Promise<void> => {
    const records = jsPsych.data.get().values() as Record<string, unknown>[];
    for (; sent < records.length; sent++) await target.send([records[sent]]);
  };
  const saveStep = { type: SaveStepPlugin, run: sendNew, record_data: false };
  const active = () => session.ended === null;

  const decline = (reason: Session['ended'], message: string) => ({
    type: SaveStepPlugin,
    record_data: false,
    message: '<p>One moment…</p>',
    run: async () => {
      session.ended = reason;
      await target.withdraw(message);
    },
  });

  const warning = {
    type: HtmlButtonResponsePlugin,
    stimulus: warningHtml(config),
    choices: ['Continue', "I'd rather not take part"],
    data: { screen: 'content_warning' },
  };
  const consent = {
    type: HtmlButtonResponsePlugin,
    stimulus: consentHtml(config, target.consentText),
    choices: ['I agree', 'I do not agree'],
    data: { screen: 'consent' },
  };
  const lastResponse = (): number => jsPsych.data.get().last(1).values()[0]?.response as number;

  let excluded = false;
  const browserCheck = {
    type: BrowserCheckPlugin,
    features: ['width', 'height', 'browser', 'browser_version', 'mobile', 'os', 'fullscreen', 'webaudio', 'vsync_rate'],
    // Always continues: exclusion runs through decline() so the save target can withdraw.
    inclusion_function: (features: Record<string, unknown>) => {
      excluded = !meetsDeviceRequirements(features, config);
      return true;
    },
    data: { screen: 'browser_check' },
  };
  const fullscreen = config.fullscreen ?? true;
  const enterFullscreen = {
    type: FullscreenPlugin,
    fullscreen_mode: true,
    message: '<p>The game is played in full screen. Leaving full screen pauses it.</p>',
    button_label: 'Switch to full screen',
    delay_after: 300,
    data: { screen: 'fullscreen' },
  };
  const exitFullscreen = { type: FullscreenPlugin, fullscreen_mode: false, delay_after: 0, record_data: false };

  const blocks = config.blocks.map((block, b) => ({
    timeline: [
      ...(block.instructions_html
        ? [{ type: HtmlButtonResponsePlugin, stimulus: block.instructions_html, choices: ['Continue'], data: { screen: 'block_instructions', block: b } }]
        : []),
      ...block.trials.flatMap((trial) => [
        {
          type: DoomTrialPlugin,
          paradigm: trialParadigm(trial).id,
          params: trial.params ?? null,
          seed: trial.seed ?? null,
          map: trial.map,
          map_name: maps.get(trial.map)?.name ?? null,
          skill: trial.skill ?? 3,
          time_limit: trial.time_limit,
          no_monsters: trial.no_monsters ?? false,
          sound: trial.sound ?? true,
          hud: trial.hud ?? true,
          automap: trial.automap ?? false,
          fullscreen,
          measures: trialMeasures(trial),
          prompt: trial.prompt_html ?? `${trialParadigm(trial).participantInstructions}<p>Click to start.</p>`,
          data: { block: b, block_name: block.name ?? null, practice: block.practice ?? false },
        },
        saveStep,
      ]),
    ],
  }));
  const questionnaires = (config.questionnaires ?? []).map(questionnaireTrial);

  const summary = (): string => {
    const trials = jsPsych.data.get().filter({ trial_type: 'doom-trial' }).values();
    const rows = trials
      .map((t, i) => {
        const seconds = t.duration_tics ? Math.round(t.duration_tics / 35) : 0;
        const kb = Math.ceil(JSON.stringify(t).length / 1000);
        return `<tr><td>${i + 1}</td><td>${escapeHtml(t.map_name ?? mapLabel(t.map))}</td><td>${escapeHtml(String(t.end_reason))}</td><td>${seconds} s</td><td>${kb} kB</td></tr>`;
      })
      .join('');
    return `
      <h1>Your data</h1>
      <p>These are the game rounds that were recorded, with the size of each round's data. The
      download contains everything listed on the consent page${config.questionnaires?.length ? ', including your answers to the questions' : ''}.</p>
      <table class="your-data"><tr><th>Round</th><th>Level</th><th>Ended by</th><th>Play time</th><th>Data</th></tr>${rows}</table>`;
  };
  const uploads = target.id !== 'download';
  const choices = uploads ? ['Submit my data', 'Download a copy', 'Withdraw and delete my data'] : ['Finish', 'Download my data'];
  const DOWNLOAD = 1;
  const WITHDRAW = 2;
  const yourData = {
    timeline: [{ type: HtmlButtonResponsePlugin, stimulus: summary, choices, data: { screen: 'your_data' } }],
    loop_function: () => {
      if (lastResponse() !== DOWNLOAD) return false;
      jsPsych.data.get().filterCustom((t: { screen?: string }) => t.screen !== 'your_data').localSave('json', fileName());
      return true;
    },
  };

  const timeline: Timeline = [
    warning,
    { timeline: [decline('declined', 'declined the content warning')], conditional_function: () => lastResponse() === 1 },
    { timeline: [consent], conditional_function: active },
    { timeline: [decline('declined', 'did not consent')], conditional_function: () => active() && lastResponse() === 1 },
    { timeline: [browserCheck], conditional_function: active },
    { timeline: [decline('excluded', 'excluded by the browser check')], conditional_function: () => active() && excluded },
    {
      timeline: [
        ...(fullscreen ? [enterFullscreen] : []),
        { type: HtmlButtonResponsePlugin, stimulus: config.instructions_html ?? DEFAULT_INSTRUCTIONS_HTML, choices: ['Continue'], data: { screen: 'instructions' } },
        ...blocks,
        ...questionnaires,
        ...(fullscreen ? [exitFullscreen] : []),
        yourData,
        {
          timeline: [decline('withdrawn', 'withdrew at the end')],
          conditional_function: () => uploads && lastResponse() === WITHDRAW,
        },
        {
          timeline: [{ ...saveStep, run: async () => { await sendNew(); await target.finish(config.completion_url); } }],
          conditional_function: active,
        },
      ],
      conditional_function: active,
    },
  ];
  return { timeline, session };
}
