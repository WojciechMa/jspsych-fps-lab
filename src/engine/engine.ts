// Runs the WebAssembly Doom engine. JS owns the engine's clock, input and frame loop, so pausing
// freezes game time and input reaches the engine only while a trial runs.
import createDoomEngine, { type DoomEngineModule } from 'doom-engine-build/doom-engine.mjs';
import wasmUrl from 'doom-engine-build/doom-engine.wasm?url';
import { EngineAudio } from './audio';
import { TrialRecorder, type TrialRecording } from './recorder';

const TICS_PER_SECOND = 35;

// Doom key codes from engine/doomgeneric/doomkeys.h.
const KEY_UP = 0xad;
const KEY_DOWN = 0xaf;
const KEY_STRAFE_LEFT = 0xa0;
const KEY_STRAFE_RIGHT = 0xa1;
const KEY_USE = 0xa2;

const KEY_BINDINGS: Readonly<Record<string, number>> = {
  KeyW: KEY_UP,
  KeyS: KEY_DOWN,
  KeyA: KEY_STRAFE_LEFT,
  KeyD: KEY_STRAFE_RIGHT,
  KeyE: KEY_USE,
  Digit1: 0x31,
  Digit2: 0x32,
  Digit3: 0x33,
  Digit4: 0x34,
  Digit5: 0x35,
  Digit6: 0x36,
  Digit7: 0x37,
};

const LEFT_BUTTON = 1;

export interface TrialOptions {
  /** MAPxx number. */
  map: number;
  /** 1–5 as in Doom's menu; 3 is "Hurt me plenty". */
  skill: number;
  /** Seconds of game time (pauses don't count); null for no limit. */
  timeLimit: number | null;
  noMonsters: boolean;
  sound: boolean;
}

export interface EngineInfo {
  wasm_sha256: string;
  commit: string;
  wads: { name: string; bytes: number; sha256: string }[];
}

type PauseCause = 'pointer_lock_lost' | 'window_blur' | 'page_hidden';

interface ActiveTrial {
  recorder: TrialRecorder;
  finish: (recording: TrialRecording) => void;
  fail: (error: Error) => void;
}

export class DoomEngine {
  readonly canvas = document.createElement('canvas');
  /** Called when the running trial pauses because the page lost focus or the mouse. */
  onPause: (() => void) | null = null;
  info!: EngineInfo;

  private module!: DoomEngineModule;
  private readonly context: CanvasRenderingContext2D;
  private readonly audio = new EngineAudio();
  private image: ImageData | null = null;
  // Engine time while stopped (null while running). Starts at 1 s so Doom's time base is non-zero.
  private frozenAt: number | null = 1000;
  private clockOffset = 0;
  private running = false;
  private frameRequest = 0;
  private trial: ActiveTrial | null = null;
  private trialResult: Promise<TrialRecording> | null = null;
  private readonly frameTimes = new Map<number, number>();
  private readonly heldKeys = new Set<number>();
  private buttons = 0;
  private mouseRemainder = 0;
  private recentErrors: string[] = [];

  private constructor() {
    this.canvas.width = 320;
    this.canvas.height = 200;
    this.canvas.className = 'doom-screen';
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw on a canvas.');
    this.context = context;
  }

  static async create(iwad: { name: string; data: Uint8Array<ArrayBuffer> }): Promise<DoomEngine> {
    const engine = new DoomEngine();
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`${wasmUrl}: HTTP ${response.status}`);
    const wasm = new Uint8Array(await response.arrayBuffer());

    engine.module = await createDoomEngine({
      wasmBinary: wasm,
      engineClockMs: () => engine.clockMs(),
      drawFrame: (pixels, width, height, frame) => engine.drawFrame(pixels, width, height, frame),
      startSound: (channel, lump, data, length, vol, sep) =>
        engine.audio.start(channel, lump, () => engine.module.HEAPU8.slice(data, data + length), vol, sep),
      updateSound: (channel, vol, sep) => engine.audio.update(channel, vol, sep),
      stopSound: (channel) => engine.audio.stop(channel),
      soundPlaying: (channel) => engine.audio.isPlaying(channel),
      print: (text) => console.log(text),
      printErr: (text) => {
        console.warn(text);
        engine.recentErrors = [...engine.recentErrors.slice(-4), text];
      },
    });

    engine.info = {
      wasm_sha256: await sha256(wasm),
      commit: __GIT_COMMIT__,
      wads: [{ name: iwad.name, bytes: iwad.data.length, sha256: await sha256(iwad.data) }],
    };

    const iwadPath = `/${iwad.name}`;
    engine.module.FS.writeFile(iwadPath, iwad.data);
    // Boots into MAP01 and idles until a trial starts; -longtics keeps full-precision turning.
    // doomgeneric's zone defaults to 6 MiB; -mb 32 leaves headroom for full IWADs (Freedoom).
    const status = engine.module.callMain([
      '-iwad', iwadPath, '-gfxmode', 'canvas', '-nogui', '-longtics', '-mb', '32',
      '-warp', '1', '-skill', '3',
    ]);
    if (status !== 0) throw new Error(engine.errorText(`engine exited with status ${status}`));
    return engine;
  }

  /** Starts a trial. Call it from a click handler: it captures the mouse and starts audio. */
  async startTrial(options: TrialOptions): Promise<void> {
    if (this.trial) throw new Error('A trial is already running.');
    const audioReady = this.audio.unlock();
    const unadjusted = await lockPointer(this.canvas);
    await audioReady;
    this.audio.setMuted(!options.sound);

    const recorder = new TrialRecorder(unadjusted);
    this.trialResult = new Promise((finish, fail) => {
      this.trial = { recorder, finish, fail };
    });
    const ticLimit = options.timeLimit ? Math.round(options.timeLimit * TICS_PER_SECOND) : 0;
    this.module._dg_start_trial(options.map, options.skill - 1, options.noMonsters ? 1 : 0, ticLimit);
    this.frameTimes.clear();
    this.run();
  }

  /** Resolves with the recording when the trial ends: exit, death or time limit. */
  result(): Promise<TrialRecording> {
    if (!this.trialResult) throw new Error('No trial has started.');
    return this.trialResult;
  }

  /** Continues a paused trial. Call it from a click handler: it captures the mouse again. */
  async resume(): Promise<void> {
    if (this.running || !this.trial) return;
    const audioReady = this.audio.unlock();
    await lockPointer(this.canvas);
    await audioReady;
    this.trial.recorder.pauseEnded(performance.now());
    this.run();
  }

  private run(): void {
    this.running = true;
    this.attachInput();
    this.startClock();
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.stopClock();
    this.detachInput();
    this.releaseInput();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private pause(cause: PauseCause): void {
    if (!this.running || !this.trial) return;
    this.stop();
    this.audio.suspend();
    this.trial.recorder.pauseStarted(cause, performance.now());
    this.onPause?.();
  }

  private readonly frame = (): void => {
    if (!this.running) return;
    const callTime = performance.now();
    try {
      this.module._dg_tick();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.drainStream(callTime);
    if (this.trial?.recorder.endReason) {
      this.finish();
      return;
    }
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  private drainStream(callTime: number): void {
    const words = this.module._dg_stream_take();
    if (words > 0 && this.trial) {
      const start = this.module._dg_stream_data();
      this.trial.recorder.add(new Int32Array(this.module.HEAPU8.buffer, start, words), callTime, this.frameTimes);
    }
    this.frameTimes.clear();
  }

  private finish(): void {
    const trial = this.trial;
    if (!trial) return;
    this.trial = null;
    this.stop();
    this.audio.stopAll();
    const start = this.module._dg_demo_data();
    const demo = this.module.HEAPU8.slice(start, start + this.module._dg_demo_length());
    trial.finish(trial.recorder.result(demo, this.module._dg_stream_dropped()));
  }

  private fail(error: unknown): void {
    const trial = this.trial;
    this.trial = null;
    this.stop();
    this.audio.stopAll();
    trial?.fail(new Error(this.errorText(error instanceof Error ? error.message : String(error))));
  }

  private errorText(fallback: string): string {
    return this.recentErrors.join(' ').trim() || fallback;
  }

  private clockMs(): number {
    return this.frozenAt ?? performance.now() - this.clockOffset;
  }

  private startClock(): void {
    if (this.frozenAt === null) return;
    this.clockOffset = performance.now() - this.frozenAt;
    this.frozenAt = null;
  }

  private stopClock(): void {
    if (this.frozenAt !== null) return;
    this.frozenAt = performance.now() - this.clockOffset;
  }

  private drawFrame(pixels: number, width: number, height: number, frame: number): void {
    this.frameTimes.set(frame, performance.now());
    // The engine's memory never grows, so this view of its framebuffer stays valid.
    this.image ??= new ImageData(
      new Uint8ClampedArray(this.module.HEAPU8.buffer, pixels, width * height * 4),
      width,
      height,
    );
    this.context.putImageData(this.image, 0, 0);
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const key = KEY_BINDINGS[event.code];
    if (key === undefined) return;
    event.preventDefault();
    const pressed = event.type === 'keydown';
    // Skips auto-repeat and key-ups whose key-down happened before play started.
    if (pressed === this.heldKeys.has(key)) return;
    if (pressed) this.heldKeys.add(key);
    else this.heldKeys.delete(key);
    this.module._dg_key(pressed ? 1 : 0, key);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.mouseRemainder += event.movementX;
    const dx = Math.trunc(this.mouseRemainder);
    if (dx === 0) return;
    this.mouseRemainder -= dx;
    this.module._dg_mouse_move(dx);
  };

  private readonly onMouseButton = (event: MouseEvent): void => {
    const buttons = event.buttons & LEFT_BUTTON;
    if (buttons === this.buttons) return;
    this.buttons = buttons;
    this.module._dg_mouse_buttons(buttons);
  };

  private readonly onPointerLockChange = (): void => {
    if (document.pointerLockElement !== this.canvas) this.pause('pointer_lock_lost');
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.pause('page_hidden');
  };

  private readonly onBlur = (): void => this.pause('window_blur');

  private attachInput(): void {
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mousedown', this.onMouseButton, true);
    window.addEventListener('mouseup', this.onMouseButton, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  private detachInput(): void {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKey, true);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('mousedown', this.onMouseButton, true);
    window.removeEventListener('mouseup', this.onMouseButton, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  /** Lets go of everything held, so no key stays pressed while the engine is stopped. */
  private releaseInput(): void {
    for (const key of this.heldKeys) this.module._dg_key(0, key);
    this.heldKeys.clear();
    if (this.buttons !== 0) {
      this.buttons = 0;
      this.module._dg_mouse_buttons(0);
    }
    this.mouseRemainder = 0;
  }
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Locks the pointer, asking for raw movement first. Returns whether raw movement was granted. */
async function lockPointer(target: HTMLElement): Promise<boolean> {
  // Only Chromium implements unadjustedMovement; other browsers may ignore the option silently.
  const canBeUnadjusted = 'userAgentData' in navigator;
  try {
    await target.requestPointerLock({ unadjustedMovement: true });
    return canBeUnadjusted;
  } catch {
    await target.requestPointerLock();
    return false;
  }
}
