// Runs the WebAssembly Doom engine on a canvas. JS owns the engine's clock, input and frame
// loop, so pausing freezes game time and input reaches the engine only while it runs.
import createDoomEngine, { type DoomEngineModule } from 'doom-engine-build/doom-engine.mjs';
import wasmUrl from 'doom-engine-build/doom-engine.wasm?url';

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

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  iwad: { name: string; data: Uint8Array };
  args?: string[];
  onPause?: () => void;
  onError?: (message: string) => void;
}

export class DoomEngine {
  /** Whether the browser granted raw (unaccelerated) pointer-lock movement. */
  unadjustedMovement = false;

  private module!: DoomEngineModule;
  private readonly context: CanvasRenderingContext2D;
  private image: ImageData | null = null;
  // Engine time while paused (null while running). Starts at 1 s so Doom's time base is non-zero.
  private frozenAt: number | null = 1000;
  private clockOffset = 0;
  private running = false;
  private frameRequest = 0;
  private readonly heldKeys = new Set<number>();
  private buttons = 0;
  private mouseRemainder = 0;
  private recentErrors: string[] = [];

  private constructor(private readonly options: EngineOptions) {
    const context = options.canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw on a canvas.');
    this.context = context;
  }

  static async create(options: EngineOptions): Promise<DoomEngine> {
    const engine = new DoomEngine(options);
    engine.module = await createDoomEngine({
      locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path),
      engineClockMs: () => engine.clockMs(),
      drawFrame: (pixels, width, height) => engine.drawFrame(pixels, width, height),
      print: (text) => console.log(text),
      printErr: (text) => {
        console.warn(text);
        engine.recentErrors = [...engine.recentErrors.slice(-4), text];
      },
    });

    const iwadPath = `/${options.iwad.name}`;
    engine.module.FS.writeFile(iwadPath, options.iwad.data);
    const status = engine.module.callMain([
      '-iwad', iwadPath, '-gfxmode', 'canvas', '-nogui', ...(options.args ?? []),
    ]);
    if (status !== 0) throw new Error(engine.errorText(`engine exited with status ${status}`));
    return engine;
  }

  /** Starts or continues play. Call it from a click handler: it captures the mouse. */
  async resume(): Promise<void> {
    if (this.running) return;
    this.unadjustedMovement = await lockPointer(this.options.canvas);
    this.running = true;
    this.attachInput();
    this.startClock();
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.stopClock();
    this.detachInput();
    this.releaseInput();
    if (document.pointerLockElement === this.options.canvas) document.exitPointerLock();
    this.options.onPause?.();
  }

  private readonly frame = (): void => {
    if (!this.running) return;
    try {
      this.module._dg_tick();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.frameRequest = requestAnimationFrame(this.frame);
  };

  private fail(error: unknown): void {
    this.running = false;
    this.stopClock();
    this.detachInput();
    if (document.pointerLockElement === this.options.canvas) document.exitPointerLock();
    this.options.onError?.(this.errorText(error instanceof Error ? error.message : String(error)));
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

  private drawFrame(pixels: number, width: number, height: number): void {
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
    if (document.pointerLockElement !== this.options.canvas) this.pause();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.pause();
  };

  private readonly onBlur = (): void => this.pause();

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

  /** Lets go of everything held, so no key stays pressed while the engine is paused. */
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
