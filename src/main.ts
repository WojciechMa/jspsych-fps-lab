// Boots one study: jatos.js (inside JATOS), the study config, the IWAD and the engine, then runs
// the study's timeline.
import 'jspsych/css/jspsych.css';
import './style.css';
import { initJsPsych } from 'jspsych';
import { DoomEngine } from './engine/engine';
import { useDoomEngine } from './plugins/plugin-doom-trial';
import { createSaveTarget, waitForJatos } from './save/targets';
import { fetchJson, loadStudy } from './study/config';
import { buildTimeline } from './study/timeline';

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
  const jatos = await waitForJatos();
  const query = new URLSearchParams(location.search);
  const input = jatos?.componentInput as { study?: unknown } | undefined;
  const studyId = jatos ? input?.study : (query.get('study') ?? 'demo');
  if (typeof studyId !== 'string') throw new Error('The JATOS component input needs {"study": "<id>"}.');
  const config = await loadStudy(studyId, fetchJson);
  const target = createSaveTarget(config, jatos);
  document.title = config.title;

  // Dev builds play miniwad, or ?iwad=<name>.wad from public/wads; production loads the study's
  // IWAD gzipped.
  const iwad = config.iwad ?? 'freedoom2.wad';
  const requestedIwad = query.get('iwad');
  const devIwad = requestedIwad && /^[a-z0-9-]+\.wad$/.test(requestedIwad) ? requestedIwad : 'miniwad.wad';
  const wad = import.meta.env.DEV
    ? { name: devIwad, url: `${import.meta.env.BASE_URL}wads/${devIwad}` }
    : { name: iwad, url: `${import.meta.env.BASE_URL}wads/${iwad}.gz` };
  const data = await fetchWithProgress(wad.url, (fraction) => {
    progress.value = fraction;
  });
  progress.hidden = true;
  message.textContent = 'Starting the engine…';
  useDoomEngine(await DoomEngine.create({ name: wad.name, data }));
  loader.remove();

  // Stored as data only, never put into the page.
  const source = jatos ? jatos.urlQueryParameters : Object.fromEntries(query);
  const urlParams = Object.fromEntries(
    (config.url_params ?? []).filter((name) => typeof source[name] === 'string').map((name) => [name, source[name].slice(0, 200)]),
  );

  const jsPsych = initJsPsych({
    on_finish: () => {
      const text =
        session.ended === 'declined'
          ? 'You chose not to take part. Nothing was recorded. You can close this page.'
          : session.ended === 'withdrawn'
            ? 'Your data was deleted. Thank you for your time. You can close this page.'
            : 'Finished. Thank you! You can close this page.';
      const p = document.createElement('p');
      p.textContent = text;
      jsPsych.getDisplayElement().replaceChildren(p);
    },
  });
  jsPsych.data.addProperties({ study_id: studyId, save_target: target.id, url_params: urlParams });
  const { timeline, session } = buildTimeline(jsPsych, config, target, dataFileName);
  await jsPsych.run(timeline);
}

main().catch((error: unknown) => {
  const text = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
  const box = document.createElement('pre');
  box.className = 'error';
  box.textContent = text;
  if (document.body.contains(loader)) loader.replaceChildren(box);
  else document.body.replaceChildren(box);
});
