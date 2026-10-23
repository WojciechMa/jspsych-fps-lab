// M0 page: loads miniwad and plays MAP01 so the engine build can be checked locally and on Pages.
import './style.css';
import { DoomEngine } from './engine/doomEngine';

const canvas = element<HTMLCanvasElement>('#screen');
const overlay = element<HTMLDivElement>('#overlay');
const message = element<HTMLParagraphElement>('#message');
const progress = element<HTMLProgressElement>('#progress');
const status = element<HTMLParagraphElement>('#status');

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

function show(text: string): void {
  message.textContent = text;
  overlay.hidden = false;
}

async function fetchWithProgress(url: string, onProgress: (fraction: number) => void): Promise<Uint8Array> {
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
  return data;
}

async function main(): Promise<void> {
  const wad = await fetchWithProgress(`${import.meta.env.BASE_URL}wads/miniwad.wad`, (fraction) => {
    progress.value = fraction;
  });
  progress.hidden = true;
  show('Starting the engine…');

  const engine = await DoomEngine.create({
    canvas,
    iwad: { name: 'miniwad.wad', data: wad },
    args: ['-warp', '1', '-skill', '3'],
    onPause: () => show('Paused. Click to continue.'),
    onError: (text) => {
      overlay.onclick = null;
      show(`The engine stopped: ${text}`);
    },
  });

  show('Click to play. WASD moves, the mouse turns, left click fires, E uses. Esc pauses.');
  overlay.onclick = async () => {
    try {
      await engine.resume();
      overlay.hidden = true;
      status.textContent = `Raw mouse input: ${engine.unadjustedMovement ? 'yes' : 'no'}`;
    } catch {
      show('The mouse could not be captured. Click again.');
    }
  };
}

main().catch((error: unknown) => {
  show(`Could not start: ${error instanceof Error ? error.message : String(error)}`);
});
