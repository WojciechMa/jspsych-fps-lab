import { describe, expect, it } from 'vitest';
import { StreamDecoder, type StreamSink } from './stream';
import type { EndReason, FrameState, GameEvent, TicState } from './types';

const FU = 65536;

function collect() {
  const calls: { start: number[]; tics: TicState[]; events: GameEvent[]; frames: FrameState[]; ends: [EndReason, number][]; order: string[] } =
    { start: [], tics: [], events: [], frames: [], ends: [], order: [] };
  const sink: StreamSink = {
    onStart: (id) => (calls.start.push(id), calls.order.push('start')),
    onTic: (t) => (calls.tics.push(t), calls.order.push('tic')),
    onEvent: (e) => (calls.events.push(e), calls.order.push('event')),
    onFrame: (f) => (calls.frames.push(f), calls.order.push('frame')),
    onEnd: (reason, tic) => (calls.ends.push([reason, tic]), calls.order.push('end')),
  };
  return { calls, sink };
}

function ticRecord(tic: number, monsters: number[][]): number[] {
  const payload = [
    tic, 10 * FU, -20 * FU, 0, 0x40000000, FU / 2, 0, 0, 87, 50, 2, 40, 3, 0, 1, 12, 905, 1, 2, 0,
    25, -24, 16384, 1, 7, monsters.length,
  ];
  return [1, payload.length + monsters.length * 7, ...payload, ...monsters.flat()];
}

describe('StreamDecoder', () => {
  it('decodes every record type in stream order', () => {
    const { calls, sink } = collect();
    const words = Int32Array.from([
      6, 1, 9,
      2, 7, 1, 0, 9, 0, 33, 12, 88,
      ...ticRecord(0, [[33, 2, 64 * FU, 32 * FU, 0, 0xc0000000 | 0, 30]]),
      3, 2, 1, 1,
      4, 7, 33, 2, 150, 144, 0, 64 * FU, 32 * FU,
      5, 2, 4, 1,
    ]);
    new StreamDecoder(sink).add(words, 500, new Map([[1, 510]]));

    expect(calls.order).toEqual(['start', 'event', 'tic', 'frame', 'end']);
    expect(calls.start).toEqual([9]);
    expect(calls.events[0]).toEqual({ tic: 0, type: 'damage', target: 9, inflictor: null, source: 33, amount: 12, healthAfter: 88 });

    const t = calls.tics[0];
    expect(t).toMatchObject({
      tic: 0, timeMs: 500, x: 10, y: -20, angle: 90, momX: 0.5, health: 87, armor: 50, weapon: 2,
      ammo: [40, 3, 0, 1], sector: 12, sectorTag: 905, kills: 1, items: 2, forward: 25, side: -24,
      turn: 90, buttons: 1, sectorSpecial: 7,
    });
    expect(t.monsters).toEqual([{ id: 33, type: 2, x: 64, y: 32, z: 0, angle: 270, health: 30 }]);

    expect(calls.frames).toEqual([
      { frame: 1, tic: 1, timeMs: 510, visible: [{ id: 33, type: 2, pixels: 150, light: 144, shadow: false, x: 64, y: 32 }] },
    ]);
    expect(calls.ends).toEqual([['timeout', 1]]);
  });

  it('decodes events with null ids and flags', () => {
    const { calls, sink } = collect();
    const words = Int32Array.from([
      2, 7, 4, 3, 9, 0x20000000, 0, 2048 * FU, 0,
      2, 7, 5, 3, 9, 33, 2, 1, 0,
      2, 7, 8, 3, 1, 2, 4, 0, 0,
      2, 7, 99, 3, 0, 0, 0, 0, 0,
    ]);
    new StreamDecoder(sink).add(words, 0, new Map());
    expect(calls.events).toEqual([
      { tic: 3, type: 'shot', shooter: 9, angle: 45, slope: 0, distance: 2048, missile: null },
      { tic: 3, type: 'hit', shooter: 9, target: 33, targetType: 2, monster: true },
      { tic: 3, type: 'sound', sfx: 1, origin: 'sector', originId: 4 },
      { tic: 3, type: 'unknown', kind: 99 },
    ]);
  });
});
