// jsPsych plugin: plays one Doom map as a trial. The trial ends at the exit, on death or at the
// time limit and returns the engine's recording: per-tic state, events, sprite visibility and
// the demo for exact replay.
import { type JsPsych, type JsPsychPlugin, ParameterType, type TrialType } from 'jspsych';
import type { DoomEngine } from '../engine/engine';
import type { TrialRecording } from '../engine/recorder';

let engine: DoomEngine | null = null;

/** The page boots one engine; every doom-trial reuses it. */
export function useDoomEngine(instance: DoomEngine): void {
  engine = instance;
}

const info = <const>{
  name: 'doom-trial',
  version: '0.1.0',
  parameters: {
    /** MAPxx number to play. */
    map: { type: ParameterType.INT, default: 1 },
    /** 1–5 as in Doom's menu; 3 is "Hurt me plenty". */
    skill: { type: ParameterType.INT, default: 3 },
    /** Limit in seconds of game time (pauses don't count); null for none. */
    time_limit: { type: ParameterType.FLOAT, default: null },
    no_monsters: { type: ParameterType.BOOL, default: false },
    sound: { type: ParameterType.BOOL, default: true },
    /** Shown over the game until the participant clicks to start. */
    prompt: { type: ParameterType.HTML_STRING, default: '<p>Click to start.</p>' },
  },
  data: {
    map: { type: ParameterType.INT },
    skill: { type: ParameterType.INT },
    time_limit: { type: ParameterType.FLOAT },
    no_monsters: { type: ParameterType.BOOL },
    sound: { type: ParameterType.BOOL },
    /** exit, secret_exit, death, timeout, aborted or error. */
    end_reason: { type: ParameterType.STRING },
    error: { type: ParameterType.STRING },
    duration_tics: { type: ParameterType.INT },
    unadjusted_movement: { type: ParameterType.BOOL },
    tics: { type: ParameterType.OBJECT },
    monsters: { type: ParameterType.OBJECT },
    events: { type: ParameterType.OBJECT, array: true },
    frames: { type: ParameterType.OBJECT },
    visible: { type: ParameterType.OBJECT },
    pauses: { type: ParameterType.OBJECT, array: true },
    demo: { type: ParameterType.STRING },
    demo_format: { type: ParameterType.STRING },
    stream_dropped: { type: ParameterType.INT },
    /** Engine build hash, commit and WAD hashes, needed to replay the demo. */
    engine: { type: ParameterType.OBJECT },
  },
};

type Info = typeof info;

class DoomTrialPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private readonly jsPsych: JsPsych) {}

  async trial(display_element: HTMLElement, trial: TrialType<Info>) {
    if (!engine) throw new Error('doom-trial: call useDoomEngine() before running a trial.');
    const doom = engine;
    const settings = {
      map: trial.map ?? 1,
      skill: trial.skill ?? 3,
      time_limit: trial.time_limit ?? null,
      no_monsters: trial.no_monsters ?? false,
      sound: trial.sound ?? true,
    };

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

    const outcome = await new Promise<TrialRecording | Error>((resolve) => {
      let started = false;
      overlay.onclick = () => {
        overlay.hidden = true;
        if (started) {
          doom.resume().catch(captureFailed);
          return;
        }
        started = true;
        doom
          .startTrial({
            map: settings.map,
            skill: settings.skill,
            timeLimit: settings.time_limit,
            noMonsters: settings.no_monsters,
            sound: settings.sound,
          })
          .then(
            () => doom.result().then(resolve, resolve),
            () => {
              started = false;
              captureFailed();
            },
          );
      };
    });
    overlay.onclick = null;
    doom.onPause = null;

    if (outcome instanceof Error) {
      return { ...settings, end_reason: 'error', error: outcome.message, engine: doom.info };
    }
    return { ...settings, ...outcome, engine: doom.info };
  }
}

export default DoomTrialPlugin;
