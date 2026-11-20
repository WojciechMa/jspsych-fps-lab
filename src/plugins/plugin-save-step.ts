// jsPsych plugin: runs an async step (saving, ending the study) between trials. On failure it
// shows the error and a retry button, so no data is skipped silently.
import { type JsPsych, type JsPsychPlugin, ParameterType, type TrialType } from 'jspsych';

const info = <const>{
  name: 'save-step',
  version: '0.1.0',
  parameters: {
    run: { type: ParameterType.FUNCTION, default: undefined },
    message: { type: ParameterType.HTML_STRING, default: '<p>Saving…</p>' },
  },
  data: {
    attempts: { type: ParameterType.INT },
  },
};

type Info = typeof info;

class SaveStepPlugin implements JsPsychPlugin<Info> {
  static info = info;

  constructor(private readonly jsPsych: JsPsych) {}

  async trial(display_element: HTMLElement, trial: TrialType<Info>) {
    const run = trial.run as () => Promise<void>;
    for (let attempts = 1; ; attempts++) {
      display_element.innerHTML = trial.message ?? '';
      try {
        await run();
        return { attempts };
      } catch (error) {
        const text = document.createElement('p');
        text.textContent = `Saving failed: ${error instanceof Error ? error.message : String(error)}`;
        const retry = document.createElement('button');
        retry.className = 'jspsych-btn';
        retry.textContent = 'Try again';
        display_element.replaceChildren(text, retry);
        await new Promise((resolve) => retry.addEventListener('click', resolve, { once: true }));
      }
    }
  }
}

export default SaveStepPlugin;
