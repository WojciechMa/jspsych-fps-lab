// Types for the emscripten output that `npm run build:engine` writes to src/engine/build.
declare module 'doom-engine-build/doom-engine.mjs' {
  export interface DoomEngineModule {
    FS: { writeFile(path: string, data: Uint8Array): void };
    HEAPU8: Uint8Array<ArrayBuffer>;
    callMain(args: string[]): number;
    _dg_tick(): void;
    _dg_key(pressed: number, key: number): void;
    _dg_mouse_move(dx: number): void;
    _dg_mouse_buttons(buttons: number): void;
    _dg_start_trial(map: number, skill: number, flags: number, tics: number): void;
    _dg_abort_trial(): void;
    /** Pointers are byte offsets into HEAPU8. */
    _dg_stream_data(): number;
    _dg_stream_take(): number;
    _dg_stream_dropped(): number;
    _dg_demo_data(): number;
    _dg_demo_length(): number;
  }

  /** Called by the engine (EM_JS functions in engine/web). */
  export interface DoomEngineHooks {
    wasmBinary?: Uint8Array;
    engineClockMs(): number;
    drawFrame(pixels: number, width: number, height: number, frame: number): void;
    startSound(channel: number, lump: number, data: number, length: number, vol: number, sep: number): void;
    updateSound(channel: number, vol: number, sep: number): void;
    stopSound(channel: number): void;
    soundPlaying(channel: number): boolean;
    print?(text: string): void;
    printErr?(text: string): void;
  }

  export default function createDoomEngine(hooks: DoomEngineHooks): Promise<DoomEngineModule>;
}
