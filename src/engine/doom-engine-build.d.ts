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
  }

  export interface DoomEngineHooks {
    engineClockMs(): number;
    drawFrame(pixels: number, width: number, height: number): void;
    locateFile?(path: string, prefix: string): string;
    print?(text: string): void;
    printErr?(text: string): void;
  }

  export default function createDoomEngine(hooks: DoomEngineHooks): Promise<DoomEngineModule>;
}
