// M1 demo: one Doom trial in a jsPsych timeline, ending with a JSON download of the data.
import 'jspsych/css/jspsych.css';
import './style.css';
import HtmlButtonResponsePlugin from '@jspsych/plugin-html-button-response';
import { initJsPsych } from 'jspsych';
import { DoomEngine } from './engine/engine';
import DoomTrialPlugin, { useDoomEngine } from './plugins/plugin-doom-trial';

// The Pages workflow adds Freedoom, gzipped. Dev builds play miniwad, or ?iwad=<name>.wad from
// public/wads.
const requestedIwad = new URLSearchParams(location.search).get('iwad');
const devIwad = requestedIwad && /^[a-z0-9-]+\.wad$/.test(requestedIwad) ? requestedIwad : 'miniwad.wad';
const WAD = import.meta.env.DEV
  ? { name: devIwad, url: `${import.meta.env.BASE_URL}wads/${devIwad}` }
  : { name: 'freedoom2.wad', url: `${import.meta.env.BASE_URL}wads/freedoom2.wad.gz` };

const loader = element<HTMLDivElement>('#loader');
const message = element<HTMLParagraphElement>('#message');
const progress = element<HTMLProgressElement>('#progress');

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

async function fetchWithProgress(
  url: string,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(Math.min(received / total, 1));
  }
  const data = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  // gzip magic number: .gz files arrive without Content-Encoding, so the browser leaves them packed.
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const unpacked = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(unpacked).arrayBuffer());
}

function dataFileName(): string {
  return `jspsych-fps-lab_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

async function main(): Promise<void> {
  const wad = await fetchWithProgress(WAD.url, (fraction) => {
    progress.value = fraction;
  });
  progress.hidden = true;
  message.textContent = 'Starting the engine…';
  useDoomEngine(await DoomEngine.create({ name: WAD.name, data: wad }));
  loader.remove();

  const jsPsych = initJsPsych({
    on_finish: () => {
      jsPsych.getDisplayElement().innerHTML = '<p>Finished. You can close this page.</p>';
    },
  });

  await jsPsych.run([
    {
      type: HtmlButtonResponsePlugin,
      stimulus: `
        <h1>Doom trial</h1>
        <p>Find the exit. The trial ends at the exit, if you die, or after 60 seconds of play.</p>
        <p>W A S D move, the mouse turns, left click fires, E opens doors and presses switches,
        1–7 switch weapons. Esc pauses the game.</p>
        <p>While you play, the game records 35 times per second your position, view direction,
        movement and button presses, health and ammunition, and the monsters that are awake or
        on screen. It also logs game events (shots, hits, damage, pickups, doors and switches,
        death, exit), pauses, and a replay of the run. No name or other personal details are
        recorded. The data stays in this browser until you download it at the end; nothing is
        uploaded.</p>`,
      choices: ['Continue'],
    },
    { type: DoomTrialPlugin, map: 1, skill: 3, time_limit: 60 },
    {
      type: HtmlButtonResponsePlugin,
      stimulus: '<p>The trial is over. The recorded data stays in this browser until you download it.</p>',
      choices: ['Download data (JSON)'],
      on_finish: () => jsPsych.data.get().localSave('json', dataFileName()),
    },
  ]);
}

main().catch((error: unknown) => {
  const text = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
  if (document.body.contains(loader)) message.textContent = text;
  else document.body.textContent = text;
});
