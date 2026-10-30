// Builders for synthetic engine data in tests.
import type { FrameState, TicState, TrialEnd, VisibleMonster } from '../engine/types';
import type { MeasureSpec } from './registry';
import { MeasureRunner } from './runner';
import type { TrialInfo } from './types';

export const PLAYER = 1;
export const TIC_MS = 1000 / 35;

export function tic(n: number, fields: Partial<TicState> = {}): TicState {
  return {
    tic: n,
    timeMs: 1000 + n * TIC_MS,
    x: 0,
    y: 0,
    z: 0,
    angle: 0,
    momX: 0,
    momY: 0,
    momZ: 0,
    health: 100,
    armor: 0,
    weapon: 1,
    ammo: [50, 0, 0, 0],
    sector: 0,
    sectorTag: 0,
    sectorSpecial: 0,
    kills: 0,
    items: 0,
    secrets: 0,
    forward: 0,
    side: 0,
    turn: 0,
    buttons: 0,
    monsters: [],
    ...fields,
  };
}

export function frame(n: number, ticsRun: number, visible: Partial<VisibleMonster>[] = []): FrameState {
  return {
    frame: n,
    tic: ticsRun,
    timeMs: 1000 + ticsRun * TIC_MS - 5,
    visible: visible.map((v) => ({ id: 0, type: 1, pixels: 100, light: 160, shadow: false, x: 0, y: 0, ...v })),
  };
}

export const TRIAL: TrialInfo = {
  paradigm: 'classic',
  mode: 0,
  params: {},
  seed: null,
  map: 1,
  skill: 3,
  noMonsters: false,
  engine: { wasm_sha256: 'wasm', commit: 'commit', wads: [{ name: 'test.wad', bytes: 3, sha256: 'wad' }] },
};

export function end(durationTics: number, fields: Partial<TrialEnd> = {}): TrialEnd {
  return {
    reason: 'timeout',
    durationTics,
    playerId: PLAYER,
    unadjustedMovement: true,
    demo: new Uint8Array([1, 2, 3]),
    streamDropped: 0,
    ...fields,
  };
}

/** A started runner with the player's id set, as during a trial. */
export function startRunner(specs: MeasureSpec[], inputTarget: EventTarget | null = null): MeasureRunner {
  const runner = new MeasureRunner(specs);
  runner.start(TRIAL, inputTarget);
  runner.onStart(PLAYER);
  return runner;
}
