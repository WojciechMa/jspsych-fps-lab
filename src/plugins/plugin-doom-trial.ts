// jsPsych plugin: plays one Doom map as a trial. The trial ends at the exit, on death or at the
// time limit. Its data are the trial settings plus the results of the active measures; only those
// measures' outputs are recorded.
import { type JsPsych, type JsPsychPlugin, ParameterType, type TrialType } from 'jspsych';
import type { DoomEngine } from '../engine/engine';
import type { TrialEnd } from '../engine/types';
import { DEFAULT_MEASURES, type MeasureSpec } from '../measures/registry';
import { MeasureRunner } from '../measures/runner';

let engine: DoomEngine | null = null;

/** The page boots one engine; every doom-trial reuses it. */
export function useDoomEngine(instance: DoomEngine): void {
  engine = instance;
}

const info = <const>{
  name: 'doom-trial',
  version: '0.2.0',
  parameters: {
    /** MAPxx number to play. */
    map: { type: ParameterType.INT, default: 1 },
    /** 1–5 as in Doom's menu; 3 is "Hurt me plenty". */
    skill: { type: ParameterType.INT, default: 3 },
    /** Limit in seconds of game time (pauses don't count); null for none. */
    time_limit: { type: ParameterType.FLOAT, default: null },
    no_monsters: { type: ParameterType.BOOL, default: false },
    sound: { type: ParameterType.BOOL, default: true },
    /** Measure ids, or { id, params } objects; null = DEFAULT_MEASURES. */
    measures: { type: ParameterType.COMPLEX, default: null },
    /** Shown over the game until the participant clicks to start. */
    prompt: { type: ParameterType.HTML_STRING, default: '<p>Click to start.</p>' },
  },
  data: {
    paradigm: { type: ParameterType.STRING },
    mode: { type: ParameterType.INT },
    seed: { type: ParameterType.INT },
    input_profile: { type: ParameterType.STRING },
    map: { type: ParameterType.INT },
    skill: { type: ParameterType.INT },
    time_limit: { type: ParameterType.FLOAT },
    no_monsters: { type: ParameterType.BOOL },
    sound: { type: ParameterType.BOOL },
    /** exit, secret_exit, death, timeout, aborted or error. */
    end_reason: { type: ParameterType.STRING },
    error: { type: ParameterType.STRING },
    duration_tics: { type: ParameterType.INT },
    player_id: { type: ParameterType.INT },
    unadjusted_movement: { type: ParameterType.BOOL },
    stream_dropped: { type: ParameterType.INT },
    /** Active measures: id, version and parameters. */
    measures: { type: ParameterType.COMPLEX, array: true },
    /** Per measure id: { summary, raw } or { error }. */
    results: { type: ParameterType.COMPLEX },
    /** Engine build hash, commit and WAD hashes. */
    engine: { type: ParameterType.COMPLEX },
  },
};

type Info = typeof info;

class DoomTrialPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private readonly jsPsych: JsPsych) {}

  async trial(display_element: HTMLElement, trial: TrialType<Info>) {
    if (!engine) throw new Error('doom-trial: call useDoomEngine() before running a trial.');
    const doom = engine;
    // Classic Doom (mode 0) until the paradigm registry exists (M4).
    const settings = {
      paradigm: 'classic',
      mode: 0,
      seed: null,
      input_profile: 'keyboard-mouse',
      map: trial.map ?? 1,
      skill: trial.skill ?? 3,
      time_limit: trial.time_limit ?? null,
      no_monsters: trial.no_monsters ?? false,
      sound: trial.sound ?? true,
    };
    const runner = new MeasureRunner((trial.measures as MeasureSpec[] | null) ?? DEFAULT_MEASURES);

    const stage = document.createElement('div');
    stage.className = 'doom-stage';
    const overlay = document.createElement('div');
    overlay.className = 'doom-overlay';
    stage.append(doom.canvas, overlay);
    display_element.replaceChildren(stage);

    const show = (html: string): void => {
      overlay.innerHTML = html;
      overlay.hidden = false;
    };
    const captureFailed = (): void => show('<p>The mouse could not be captured. Click to try again.</p>');
    show(trial.prompt ?? '');
    doom.onPause = () => show('<p>Paused. Click to continue.</p>');

    const outcome = await new Promise<TrialEnd | Error>((resolve) => {
      let started = false;
      overlay.onclick = () => {
        overlay.hidden = true;
        if (started) {
          doom.resume().catch(captureFailed);
          return;
        }
        started = true;
        doom
          .startTrial(
            {
              map: settings.map,
              skill: settings.skill,
              timeLimit: settings.time_limit,
              noMonsters: settings.no_monsters,
              sound: settings.sound,
            },
            runner,
          )
          .then(
            () => {
              runner.start(
                {
                  paradigm: settings.paradigm,
                  mode: settings.mode,
                  params: {},
                  seed: settings.seed,
                  map: settings.map,
                  skill: settings.skill,
                  noMonsters: settings.no_monsters,
                  engine: doom.info,
                },
                window,
              );
              doom.result().then(resolve, resolve);
            },
            () => {
              started = false;
              captureFailed();
            },
          );
      };
    });
    overlay.onclick = null;
    doom.onPause = null;

    const base = { ...settings, measures: runner.active, engine: doom.info };
    if (outcome instanceof Error) {
      runner.dispose();
      return { ...base, end_reason: 'error', error: outcome.message };
    }
    return {
      ...base,
      end_reason: outcome.reason,
      duration_tics: outcome.durationTics,
      player_id: outcome.playerId,
      unadjusted_movement: outcome.unadjustedMovement,
      stream_dropped: outcome.streamDropped,
      results: runner.finish(outcome),
    };
  }
}

export default DoomTrialPlugin;
