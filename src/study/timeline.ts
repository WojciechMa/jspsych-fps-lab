// Builds a study's jsPsych timeline from its config: content warning → consent → instructions →
// blocks of Doom trials (each followed by a save step) → "your data" → submit, download or withdraw.
import HtmlButtonResponsePlugin from '@jspsych/plugin-html-button-response';
import type { JsPsych } from 'jspsych';
import DoomTrialPlugin from '../plugins/plugin-doom-trial';
import SaveStepPlugin from '../plugins/plugin-save-step';
import type { SaveTarget } from '../save/targets';
import { DEFAULT_INSTRUCTIONS_HTML, type StudyConfig, trialMeasures } from './config';
import { consentHtml, escapeHtml, warningHtml } from './pages';

// jsPsych doesn't export its TimelineArray type.
type Timeline = Extract<Parameters<JsPsych['run']>[0], unknown[]>;

export interface Session {
  /** Set when the participant declines the warning or consent, or withdraws. */
  ended: 'declined' | 'withdrawn' | null;
}

export function buildTimeline(
  jsPsych: JsPsych,
  config: StudyConfig,
  target: SaveTarget,
  fileName: () => string,
): { timeline: Timeline; session: Session } {
  const session: Session = { ended: null };
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

  const blocks = config.blocks.map((block, b) => ({
    timeline: [
      ...(block.instructions_html
        ? [{ type: HtmlButtonResponsePlugin, stimulus: block.instructions_html, choices: ['Continue'], data: { screen: 'block_instructions', block: b } }]
        : []),
      ...block.trials.flatMap((trial) => [
        {
          type: DoomTrialPlugin,
          map: trial.map,
          skill: trial.skill ?? 3,
          time_limit: trial.time_limit,
          no_monsters: trial.no_monsters ?? false,
          sound: trial.sound ?? true,
          measures: trialMeasures(trial),
          ...(trial.prompt_html ? { prompt: trial.prompt_html } : {}),
          data: { block: b, block_name: block.name ?? null },
        },
        saveStep,
      ]),
    ],
  }));

  const summary = (): string => {
    const trials = jsPsych.data.get().filter({ trial_type: 'doom-trial' }).values();
    const rows = trials
      .map((t, i) => {
        const seconds = t.duration_tics ? Math.round(t.duration_tics / 35) : 0;
        const kb = Math.ceil(JSON.stringify(t).length / 1000);
        return `<tr><td>${i + 1}</td><td>MAP${String(t.map).padStart(2, '0')}</td><td>${escapeHtml(String(t.end_reason))}</td><td>${seconds} s</td><td>${kb} kB</td></tr>`;
      })
      .join('');
    return `
      <h1>Your data</h1>
      <p>These are the game rounds that were recorded, with the size of each round's data. The
      download contains everything listed on the consent page.</p>
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
    {
      timeline: [
        { type: HtmlButtonResponsePlugin, stimulus: config.instructions_html ?? DEFAULT_INSTRUCTIONS_HTML, choices: ['Continue'], data: { screen: 'instructions' } },
        ...blocks,
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
