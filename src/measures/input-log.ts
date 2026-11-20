// input_log: raw key and mouse events during the trial, on the performance.now() clock
// (event.timeStamp), from passive capture listeners.
import { AUTOMAP_KEY, KEY_BINDINGS } from '../engine/keys';
import type { Measure } from './types';
import { round } from './util';

interface Params {
  keys: 'game' | 'all';
  mouseMoves: boolean;
}

const GAME_KEYS = new Set([...Object.keys(KEY_BINDINGS), 'Escape']);

export const inputLog: Measure<Params> = {
  id: 'input_log',
  // 1.1.0: 'game' keys include Tab in trials with the automap.
  version: '1.1.0',
  label: 'Input log',
  participantDescription:
    'Which keys and mouse buttons you press while playing and how you move the mouse, with their times.',
  needs: ['input'],
  estBytesPerMin: 60_000,
  paramsSchema: {
    type: 'object',
    properties: {
      keys: {
        type: 'string',
        enum: ['game', 'all'],
        default: 'game',
        description:
          "'game' logs only the game's control keys and Esc (and Tab when the trial has the automap); 'all' logs every key. Keys are stored as KeyboardEvent.code (the physical key), never as typed text. Auto-repeats are left out.",
      },
      mouseMoves: {
        type: 'boolean',
        default: true,
        description: 'Log mouse movement (movementX/Y per event; Chromium sends at most one event per frame).',
      },
    },
    additionalProperties: false,
  },
  create(ctx, params) {
    const keys = { t: [] as number[], code: [] as string[], down: [] as number[] };
    const buttons = { t: [] as number[], button: [] as number[], down: [] as number[] };
    const moves = { t: [] as number[], dx: [] as number[], dy: [] as number[] };

    const target = ctx.inputTarget;
    const gameKeys = ctx.trial.automap ? new Set([...GAME_KEYS, AUTOMAP_KEY.code]) : GAME_KEYS;
    if (target) {
      const options: AddEventListenerOptions = { capture: true, passive: true, signal: ctx.signal };
      const onKey = (event: Event): void => {
        const e = event as KeyboardEvent;
        if (e.repeat || (params.keys === 'game' && !gameKeys.has(e.code))) return;
        keys.t.push(round(e.timeStamp, 1));
        keys.code.push(e.code);
        keys.down.push(e.type === 'keydown' ? 1 : 0);
      };
      const onButton = (event: Event): void => {
        const e = event as MouseEvent;
        buttons.t.push(round(e.timeStamp, 1));
        buttons.button.push(e.button);
        buttons.down.push(e.type === 'mousedown' ? 1 : 0);
      };
      const onMove = (event: Event): void => {
        const e = event as MouseEvent;
        moves.t.push(round(e.timeStamp, 1));
        moves.dx.push(e.movementX);
        moves.dy.push(e.movementY);
      };
      target.addEventListener('keydown', onKey, options);
      target.addEventListener('keyup', onKey, options);
      target.addEventListener('mousedown', onButton, options);
      target.addEventListener('mouseup', onButton, options);
      if (params.mouseMoves) target.addEventListener('mousemove', onMove, options);
    }

    return {
      finish() {
        return {
          summary: { key_events: keys.t.length, button_events: buttons.t.length, move_events: moves.t.length },
          raw: { keys, buttons, moves: params.mouseMoves ? moves : null },
        };
      },
    };
  },
};
