import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../engine/types';
import { getMeasure, participantDescriptions, resolveParams } from './registry';
import { MeasureRunner } from './runner';
import { end, frame, PLAYER, startRunner, tic, TIC_MS, TRIAL } from './testing';

type Summary = Record<string, unknown>;
const ev = (event: GameEvent): GameEvent => event;

function resultOf(runner: MeasureRunner, id: string, durationTics: number) {
  const result = runner.finish(end(durationTics))[id];
  if ('error' in result) throw new Error(result.error);
  return result as { summary: Summary; raw: Record<string, unknown> };
}

describe('registry', () => {
  it('fills in defaults and checks parameters', () => {
    const measure = getMeasure('trajectory');
    expect(resolveParams(measure)).toEqual({ decimals: 2, cellSize: 64, revisitGapTics: 35, teleportStep: 128 });
    expect(resolveParams(measure, { cellSize: 32 }).cellSize).toBe(32);
    expect(() => resolveParams(measure, { cellsize: 32 })).toThrow('unknown parameter');
    expect(() => resolveParams(measure, { decimals: 1.5 })).toThrow('whole number');
    expect(() => resolveParams(measure, { decimals: 9 })).toThrow('at most 4');
    expect(() => resolveParams(getMeasure('input_log'), { keys: 'some' })).toThrow('one of: game, all');
    expect(() => getMeasure('nope')).toThrow('Unknown measure');
  });

  it('rejects duplicate measures and lists what participants are told', () => {
    expect(() => new MeasureRunner(['roi', { id: 'roi' }])).toThrow('listed twice');
    expect(participantDescriptions(['demo', 'roi'])).toEqual([
      getMeasure('roi').participantDescription,
      getMeasure('demo').participantDescription,
    ]);
  });

  it('records each measure with its version and resolved parameters', () => {
    const runner = new MeasureRunner([{ id: 'risk', params: { lowHealth: 40 } }]);
    expect(runner.active).toEqual([
      { id: 'risk', version: '1.0.0', params: { lowHealth: 40, engagementGapTics: 70, hazardSpecials: [4, 5, 7, 11, 16] } },
    ]);
  });

  it('switches off a failing measure but keeps the others', () => {
    const runner = startRunner(['threat_rt', 'roi']);
    runner.onTic(tic(0, { monsters: undefined as never }));
    const results = runner.finish(end(1));
    expect(results.threat_rt).toHaveProperty('error');
    expect(results.roi).toHaveProperty('summary');
  });
});

describe('trajectory', () => {
  it('measures path length, coverage, revisits and teleports', () => {
    const runner = startRunner(['trajectory']);
    let n = 0;
    // 10 units per tic along x through two cells, out to a third, then back after 40 tics.
    for (let x = 0; x <= 90; x += 10) runner.onTic(tic(n++, { x, y: 5 }));
    for (let i = 0; i < 40; i++) runner.onTic(tic(n++, { x: 140, y: 5 }));
    runner.onTic(tic(n++, { x: 100, y: 5 }));
    runner.onTic(tic(n++, { x: 600, y: 5, angle: 90 }));
    const { summary, raw } = resultOf(runner, 'trajectory', n);
    expect(summary).toMatchObject({ path_length: 180, coverage_cells: 4, revisits: 1, teleports: 1, turning_deg: 90 });
    expect((raw.x as number[]).length).toBe(n);
  });
});

describe('roi', () => {
  it('pairs enter and exit events and closes open visits at the end', () => {
    const runner = startRunner(['roi']);
    runner.onEvent(ev({ tic: 5, type: 'roi_enter', tag: 900, sector: 3 }));
    runner.onEvent(ev({ tic: 15, type: 'roi_exit', tag: 900, sector: 3 }));
    runner.onEvent(ev({ tic: 20, type: 'roi_enter', tag: 901, sector: 4 }));
    const { summary, raw } = resultOf(runner, 'roi', 30);
    expect(summary).toEqual({
      visits: 2,
      by_tag: { 900: { visits: 1, tics: 10, first_enter_tic: 5 }, 901: { visits: 1, tics: 10, first_enter_tic: 20 } },
    });
    expect(raw.exit_tic).toEqual([15, 30]);
  });
});

describe('threat_rt', () => {
  it('times turning toward, shooting and hitting a monster from its first visible frame', () => {
    const runner = startRunner(['threat_rt']);
    runner.onTic(tic(9));
    // Monster 5 at 45° to the left; monster 6 too small to count yet.
    runner.onFrame(frame(1, 10, [{ id: 5, x: 100, y: 100 }, { id: 6, pixels: 10, x: 100, y: 0 }]));
    for (let n = 10; n <= 14; n++) {
      runner.onTic(tic(n, { angle: (n - 10) * 2, monsters: [{ id: 5, type: 1, x: 100, y: 100, z: 0, angle: 0, health: 20 }] }));
    }
    runner.onEvent(ev({ tic: 15, type: 'shot', shooter: PLAYER, angle: 10, slope: 0, distance: 2048, missile: null }));
    runner.onEvent(ev({ tic: 15, type: 'hit', shooter: PLAYER, target: 5, targetType: 1, monster: true }));
    runner.onEvent(ev({ tic: 15, type: 'kill', target: 5, targetType: 1, source: PLAYER }));
    runner.onTic(tic(15, { angle: 10 }));
    const { summary, raw } = resultOf(runner, 'threat_rt', 16);

    expect(raw.id).toEqual([5]);
    expect(raw.offset_deg).toEqual([45]);
    expect(raw.distance).toEqual([141.4]);
    // |offset| reaches 45 − 5 = 40° once the view has turned 5°: at 6° in tic 13.
    expect(raw).toMatchObject({ visible_tic: [10], turn_tic: [13], shot_tic: [15], hit_tic: [15], kill_tic: [15] });
    expect(raw).toMatchObject({ turning_toward_at_visible: [false], killed_by_player: [true] });
    expect(raw).toMatchObject({ rt_turn_tics: [3], rt_shot_tics: [5], rt_hit_tics: [5] });
    const visibleMs = 1000 + 10 * TIC_MS - 5;
    expect(raw.rt_turn_ms).toEqual([Number((1000 + 13 * TIC_MS - visibleMs).toFixed(1))]);
    expect(summary).toMatchObject({ monsters_seen: 1, turned: 1, shot: 1, hit: 1 });
  });

  it('gives no turn time to monsters that appear near the centre', () => {
    const runner = startRunner(['threat_rt']);
    runner.onTic(tic(0));
    runner.onFrame(frame(1, 1, [{ id: 7, x: 200, y: 3 }]));
    runner.onTic(tic(1, { monsters: [{ id: 7, type: 1, x: 200, y: 0, z: 0, angle: 0, health: 20 }] }));
    const { raw } = resultOf(runner, 'threat_rt', 2);
    expect(raw.turn_tic).toEqual([null]);
  });

  it('flags monsters that appear while the view already turns toward them, and kills by others', () => {
    const runner = startRunner(['threat_rt']);
    // Turning left (positive) in the last tic; monster 5 appears on the left, monster 6 on the right.
    runner.onTic(tic(0, { turn: 2 }));
    runner.onFrame(frame(1, 1, [{ id: 5, x: 100, y: 100 }, { id: 6, x: 100, y: -100 }]));
    runner.onEvent(ev({ tic: 2, type: 'kill', target: 6, targetType: 1, source: 77 }));
    runner.onTic(tic(2));
    const { raw } = resultOf(runner, 'threat_rt', 3);
    expect(raw).toMatchObject({ id: [5, 6], turning_toward_at_visible: [true, false], killed_by_player: [null, false] });
  });

  it('keeps reaction times in tics but not in ms when a pause fell in between', () => {
    const runner = startRunner(['threat_rt']);
    runner.onTic(tic(0));
    runner.onFrame(frame(1, 1, [{ id: 8, x: 100, y: 100 }]));
    runner.onPage({ type: 'pause', cause: 'window_blur', tic: 3, timeMs: 1100 });
    runner.onPage({ type: 'resume', tic: 3, timeMs: 9000 });
    runner.onEvent(ev({ tic: 4, type: 'shot', shooter: PLAYER, angle: 0, slope: 0, distance: 2048, missile: null }));
    runner.onTic(tic(4, { timeMs: 9010 }));
    const { raw } = resultOf(runner, 'threat_rt', 5);
    expect(raw).toMatchObject({ shot_tic: [4], rt_shot_tics: [3], rt_shot_ms: [null] });
  });
});

describe('aiming', () => {
  it('groups pellets into discharges, finds the target and credits missile hits', () => {
    const runner = startRunner(['aiming']);
    runner.onTic(tic(4));
    runner.onFrame(frame(1, 5, [{ id: 5, x: 100, y: 17.6327 }]));
    for (let i = 0; i < 7; i++) {
      runner.onEvent(ev({ tic: 5, type: 'shot', shooter: PLAYER, angle: 0, slope: 0, distance: 2048, missile: null }));
    }
    runner.onEvent(ev({ tic: 5, type: 'hit', shooter: PLAYER, target: 5, targetType: 1, monster: true }));
    runner.onEvent(ev({ tic: 5, type: 'hit', shooter: PLAYER, target: 77, targetType: 30, monster: false }));
    runner.onTic(tic(5, { weapon: 2 }));

    runner.onEvent(ev({ tic: 10, type: 'shot', shooter: PLAYER, angle: 0, slope: 0, distance: 0, missile: 40 }));
    runner.onTic(tic(10, { weapon: 4 }));
    runner.onFrame(frame(2, 11, []));
    runner.onEvent(ev({ tic: 20, type: 'damage', target: 5, inflictor: 40, source: PLAYER, amount: 20, healthAfter: 0 }));
    runner.onEvent(ev({ tic: 30, type: 'shot', shooter: PLAYER, angle: 0, slope: 0, distance: 2048, missile: null }));
    runner.onTic(tic(30));

    const { summary, raw } = resultOf(runner, 'aiming', 31);
    expect(raw).toMatchObject({
      tic: [5, 10, 30],
      weapon: [2, 4, 1],
      pellets: [7, 1, 1],
      hits: [1, 1, 0],
      target: [5, 5, null],
      error_deg: [10, 10, null],
    });
    expect(summary).toMatchObject({ discharges: 3, hit_discharges: 2, accuracy: 0.667, pellets: 9, monster_hits: 2, median_abs_error_deg: 10 });
  });
});

describe('risk', () => {
  it('sums damage by source, counts hazard crossings and low-health engagements', () => {
    const runner = startRunner(['risk']);
    const imp = { id: 5, type: 12, x: 0, y: 0, z: 0, angle: 0, health: 60 };
    runner.onTic(tic(0, { monsters: [imp] }));
    runner.onEvent(ev({ tic: 1, type: 'shot', shooter: PLAYER, angle: 0, slope: 0, distance: 2048, missile: null }));
    runner.onEvent(ev({ tic: 2, type: 'damage', target: PLAYER, inflictor: 9, source: 5, amount: 10, healthAfter: 90 }));
    runner.onTic(tic(2, { health: 90 }));
    for (let n = 30; n < 40; n++) runner.onTic(tic(n, { health: 90, sectorSpecial: 7 }));
    runner.onEvent(ev({ tic: 40, type: 'damage', target: PLAYER, inflictor: null, source: null, amount: 5, healthAfter: 85 }));
    runner.onTic(tic(40, { health: 20 }));
    runner.onTic(tic(41, { health: 20, sectorSpecial: 5 }));
    runner.onEvent(ev({ tic: 200, type: 'shot', shooter: PLAYER, angle: 0, slope: 0, distance: 2048, missile: null }));
    runner.onTic(tic(200, { health: 20 }));

    const { summary, raw } = resultOf(runner, 'risk', 201);
    expect(summary).toMatchObject({
      damage_taken: 15,
      hits_taken: 2,
      environment_damage: 5,
      damage_by_source_type: { 12: 10 },
      min_health: 20,
      hazard_crossings: 2,
      hazard_tics: 11,
      engagements: 2,
      engagements_at_low_health: 1,
      died: false,
    });
    expect(raw.engagements).toEqual({ start_tic: [1, 200], end_tic: [2, 200], start_health: [100, 20], min_health: [90, 20] });
  });
});

describe('session_quality', () => {
  it('finds dropped frames and times pauses without counting the pause as a frame gap', () => {
    const runner = startRunner(['session_quality']);
    const times = [0, 16.7, 33.4, 50.1, 100, 116.7];
    times.forEach((t, i) => runner.onFrame({ frame: i + 1, tic: i, timeMs: t, visible: [] }));
    runner.onPage({ type: 'pause', cause: 'window_blur', tic: 6, timeMs: 120 });
    runner.onPage({ type: 'resume', tic: 6, timeMs: 2120 });
    runner.onFrame({ frame: 7, tic: 6, timeMs: 2130, visible: [] });
    runner.onFrame({ frame: 8, tic: 7, timeMs: 2146.7, visible: [] });
    const { summary, raw } = resultOf(runner, 'session_quality', 8);
    expect(summary).toMatchObject({ frames: 8, dropped_frames: 1, pauses: 1, pause_ms: 2000, pauses_by_cause: { window_blur: 1 } });
    expect(summary.max_frame_ms).toBe(49.9);
    expect(raw.pauses).toEqual({ tic: [6], cause: ['window_blur'], start_ms: [120], duration_ms: [2000] });
  });
});

describe('input_log', () => {
  const event = (type: string, fields: Record<string, unknown>) => {
    const e = new Event(type);
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(e, key, { value });
    return e;
  };

  it('logs game keys, buttons and mouse moves until the trial ends', () => {
    const target = new EventTarget();
    const runner = startRunner(['input_log'], target);
    target.dispatchEvent(event('keydown', { code: 'KeyW', repeat: false, timeStamp: 100.04 }));
    target.dispatchEvent(event('keydown', { code: 'KeyW', repeat: true, timeStamp: 130 }));
    target.dispatchEvent(event('keydown', { code: 'KeyQ', repeat: false, timeStamp: 140 }));
    target.dispatchEvent(event('keyup', { code: 'KeyW', repeat: false, timeStamp: 200 }));
    target.dispatchEvent(event('mousedown', { button: 0, timeStamp: 210 }));
    target.dispatchEvent(event('mousemove', { movementX: -3, movementY: 1, timeStamp: 220 }));
    const { summary, raw } = resultOf(runner, 'input_log', 10);
    target.dispatchEvent(event('keydown', { code: 'KeyW', repeat: false, timeStamp: 300 }));

    expect(summary).toEqual({ key_events: 2, button_events: 1, move_events: 1 });
    expect(raw).toEqual({
      keys: { t: [100, 200], code: ['KeyW', 'KeyW'], down: [1, 0] },
      buttons: { t: [210], button: [0], down: [1] },
      moves: { t: [220], dx: [-3], dy: [1] },
    });
  });
});

describe('demo', () => {
  it('stores the demo as base64 with what is needed to replay it', () => {
    const runner = startRunner(['demo']);
    const { summary, raw } = resultOf(runner, 'demo', 3) as unknown as { summary: Summary; raw: string };
    expect(raw).toBe('AQID');
    expect(summary).toMatchObject({ format: 'doom-1.91-longtics', bytes: 3, tics: 3, paradigm: 'classic', mode: 0, seed: null, map: 1 });
    expect(summary.engine).toEqual(TRIAL.engine);
  });
});
