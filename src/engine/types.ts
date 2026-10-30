// Data a running trial produces. Positions are in map units, angles in degrees counter-clockwise
// from east, times in ms on the performance.now() clock. Thing ids are stable within a trial;
// null means "none".

export type EndReason = 'exit' | 'secret_exit' | 'death' | 'timeout' | 'aborted';

export interface MonsterState {
  id: number;
  type: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  health: number;
}

export interface TicState {
  tic: number;
  /** When the engine call that ran this tic began; several tics can share one call. */
  timeMs: number;
  x: number;
  y: number;
  z: number;
  angle: number;
  momX: number;
  momY: number;
  momZ: number;
  health: number;
  armor: number;
  weapon: number;
  /** Bullets, shells, cells, rockets. */
  ammo: number[];
  sector: number;
  sectorTag: number;
  sectorSpecial: number;
  kills: number;
  items: number;
  secrets: number;
  /** The tic's input: forward and side speed, turn in degrees (positive = left), button bits. */
  forward: number;
  side: number;
  turn: number;
  buttons: number;
  /** Monsters that are awake or were drawn in the last frame. */
  monsters: MonsterState[];
}

export interface VisibleMonster {
  id: number;
  type: number;
  /** Screen pixels actually drawn (after clipping) in the 320x200 frame. */
  pixels: number;
  /** Light level of the monster's sector, 0–255. */
  light: number;
  /** Drawn with the spectre's fuzz effect. */
  shadow: boolean;
  x: number;
  y: number;
}

export interface FrameState {
  frame: number;
  /** Tics run before this frame was drawn: the frame shows the state after tic `tic - 1`. */
  tic: number;
  /** When the frame was put on the canvas. */
  timeMs: number;
  visible: VisibleMonster[];
}

type Id = number | null;

export type GameEvent = { tic: number } & (
  | { type: 'damage'; target: Id; inflictor: Id; source: Id; amount: number; healthAfter: number }
  | { type: 'kill'; target: Id; targetType: number; source: Id }
  | { type: 'pickup'; item: Id; itemType: number; toucher: Id }
  | { type: 'shot'; shooter: Id; angle: number; slope: number; distance: number; missile: Id }
  | { type: 'hit'; shooter: Id; target: Id; targetType: number; monster: boolean }
  | { type: 'use'; thing: Id; line: number; special: number; side: number }
  | { type: 'cross'; thing: Id; line: number; special: number; side: number }
  | { type: 'sound'; sfx: number; origin: 'none' | 'thing' | 'sector'; originId: number | null }
  | { type: 'roi_enter'; tag: number; sector: number }
  | { type: 'roi_exit'; tag: number; sector: number }
  | { type: 'death'; killer: Id }
  | { type: 'exit'; secret: boolean }
  | { type: 'unknown'; kind: number }
);

export type PauseCause = 'pointer_lock_lost' | 'window_blur' | 'page_hidden';

export type PageEvent =
  | { type: 'pause'; cause: PauseCause; /** First tic that had not run yet. */ tic: number; timeMs: number }
  | { type: 'resume'; tic: number; timeMs: number };

/** Receives a running trial's data as the engine produces it. */
export interface TrialListener {
  /** Called once, before the first tic. */
  onStart?(playerId: number): void;
  onTic?(tic: TicState): void;
  onEvent?(event: GameEvent): void;
  onFrame?(frame: FrameState): void;
  onPage?(event: PageEvent): void;
}

export interface EngineInfo {
  wasm_sha256: string;
  commit: string;
  wads: { name: string; bytes: number; sha256: string }[];
}

export interface TrialEnd {
  reason: EndReason;
  durationTics: number;
  playerId: number;
  unadjustedMovement: boolean;
  /** The whole trial as a Doom 1.91 (-longtics) demo. */
  demo: Uint8Array;
  /** Stream records lost because the engine's buffer was full (should be 0). */
  streamDropped: number;
}
