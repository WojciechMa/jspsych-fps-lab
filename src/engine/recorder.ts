// Turns the engine's record stream (engine/web/dg_trial.c) into trial data: number columns per
// tic, tracked monster, rendered frame and visible monster, plus a list of events. Positions are
// in map units, angles in degrees counter-clockwise from east, times in ms on the
// performance.now() clock. Thing ids are stable within a trial; null means "none".

// Keep in sync with engine/web/dg_trial.c.
const REC_TIC = 1;
const REC_EVENT = 2;
const REC_FRAME = 3;
const REC_VISIBLE = 4;
const REC_END = 5;
const TIC_WORDS = 25;
const MONSTER_WORDS = 7;

const END_REASONS = [null, 'exit', 'secret_exit', 'death', 'timeout', 'aborted'] as const;
export type EndReason = NonNullable<(typeof END_REASONS)[number]>;

const SOUND_ORIGINS = ['none', 'thing', 'sector'] as const;

export type Columns = Record<string, number[]>;
export type TrialEvent = { tic: number; type: string } & Record<string, number | string | boolean | null>;

export interface PauseRecord {
  /** First tic that had not run yet when the pause began. */
  tic: number;
  cause: string;
  duration_ms: number | null;
}

export interface TrialRecording {
  end_reason: EndReason;
  duration_tics: number;
  unadjusted_movement: boolean;
  tics: Columns;
  monsters: Columns;
  events: TrialEvent[];
  frames: Columns;
  visible: Columns;
  pauses: PauseRecord[];
  /** The whole trial as a Doom 1.91 (longtics) demo, base64-encoded. */
  demo: string;
  demo_format: 'doom-1.91-longtics';
  stream_dropped: number;
}

const units = (fixed: number): number => fixed / 65536;
const degrees = (bam: number): number => ((bam >>> 0) / 2 ** 32) * 360;
const thingId = (id: number): number | null => (id === 0 ? null : id);

function columns(...names: string[]): Columns {
  return Object.fromEntries(names.map((name) => [name, []]));
}

export class TrialRecorder {
  endReason: EndReason | null = null;

  private readonly tics = columns(
    'tic', 'time_ms', 'x', 'y', 'z', 'angle', 'mom_x', 'mom_y', 'mom_z', 'health', 'armor',
    'weapon', 'ammo_bullets', 'ammo_shells', 'ammo_cells', 'ammo_rockets', 'sector',
    'sector_tag', 'kills', 'items', 'secrets', 'forward', 'side', 'turn', 'buttons',
  );
  private readonly monsters = columns('tic', 'id', 'type', 'x', 'y', 'z', 'angle', 'health');
  private readonly frames = columns('frame', 'tic', 'time_ms');
  private readonly visible = columns('frame', 'id', 'type', 'pixels', 'light', 'shadow');
  private readonly events: TrialEvent[] = [];
  private readonly pauses: PauseRecord[] = [];
  private pauseStartedAt = 0;
  private nextTic = 0;
  private currentFrame = 0;
  private endTic = 0;

  constructor(private readonly unadjustedMovement: boolean) {}

  /** Adds one drained chunk of the stream. callTime is when the engine call that wrote it began. */
  add(words: Int32Array, callTime: number, frameTimes: ReadonlyMap<number, number>): void {
    let i = 0;
    while (i + 2 <= words.length) {
      const type = words[i];
      const p = i + 2;
      switch (type) {
        case REC_TIC:
          this.addTic(words, p, callTime);
          break;
        case REC_EVENT:
          this.events.push(decodeEvent(words, p));
          break;
        case REC_FRAME:
          this.currentFrame = words[p];
          this.frames.frame.push(words[p]);
          this.frames.tic.push(words[p + 1]);
          this.frames.time_ms.push(frameTimes.get(words[p]) ?? callTime);
          break;
        case REC_VISIBLE:
          this.visible.frame.push(this.currentFrame);
          this.visible.id.push(words[p]);
          this.visible.type.push(words[p + 1]);
          this.visible.pixels.push(words[p + 2]);
          this.visible.light.push(words[p + 3]);
          this.visible.shadow.push(words[p + 4]);
          break;
        case REC_END:
          this.endReason = END_REASONS[words[p]] ?? 'aborted';
          this.endTic = words[p + 1];
          break;
      }
      i = p + words[i + 1];
    }
  }

  pauseStarted(cause: string, now: number): void {
    this.pauses.push({ tic: this.nextTic, cause, duration_ms: null });
    this.pauseStartedAt = now;
  }

  pauseEnded(now: number): void {
    const pause = this.pauses.at(-1);
    if (pause && pause.duration_ms === null) pause.duration_ms = now - this.pauseStartedAt;
  }

  result(demo: Uint8Array, streamDropped: number): TrialRecording {
    return {
      end_reason: this.endReason ?? 'aborted',
      duration_tics: this.endTic,
      unadjusted_movement: this.unadjustedMovement,
      tics: this.tics,
      monsters: this.monsters,
      events: this.events,
      frames: this.frames,
      visible: this.visible,
      pauses: this.pauses,
      demo: toBase64(demo),
      demo_format: 'doom-1.91-longtics',
      stream_dropped: streamDropped,
    };
  }

  private addTic(w: Int32Array, p: number, callTime: number): void {
    const t = this.tics;
    const tic = w[p];
    this.nextTic = tic + 1;
    t.tic.push(tic);
    t.time_ms.push(callTime);
    t.x.push(units(w[p + 1]));
    t.y.push(units(w[p + 2]));
    t.z.push(units(w[p + 3]));
    t.angle.push(degrees(w[p + 4]));
    t.mom_x.push(units(w[p + 5]));
    t.mom_y.push(units(w[p + 6]));
    t.mom_z.push(units(w[p + 7]));
    t.health.push(w[p + 8]);
    t.armor.push(w[p + 9]);
    t.weapon.push(w[p + 10]);
    t.ammo_bullets.push(w[p + 11]);
    t.ammo_shells.push(w[p + 12]);
    t.ammo_cells.push(w[p + 13]);
    t.ammo_rockets.push(w[p + 14]);
    t.sector.push(w[p + 15]);
    t.sector_tag.push(w[p + 16]);
    t.kills.push(w[p + 17]);
    t.items.push(w[p + 18]);
    t.secrets.push(w[p + 19]);
    t.forward.push(w[p + 20]);
    t.side.push(w[p + 21]);
    // angleturn: 65536 units per full turn.
    t.turn.push((w[p + 22] / 65536) * 360);
    t.buttons.push(w[p + 23]);

    const m = this.monsters;
    const count = w[p + 24];
    for (let k = 0; k < count; k++) {
      const q = p + TIC_WORDS + k * MONSTER_WORDS;
      m.tic.push(tic);
      m.id.push(w[q]);
      m.type.push(w[q + 1]);
      m.x.push(units(w[q + 2]));
      m.y.push(units(w[q + 3]));
      m.z.push(units(w[q + 4]));
      m.angle.push(degrees(w[q + 5]));
      m.health.push(w[q + 6]);
    }
  }
}

function decodeEvent(w: Int32Array, p: number): TrialEvent {
  const [kind, tic, a, b, c, d, e] = w.subarray(p, p + 7);
  switch (kind) {
    case 1:
      return { tic, type: 'damage', target: thingId(a), inflictor: thingId(b), source: thingId(c), amount: d, health_after: e };
    case 2:
      return { tic, type: 'kill', target: thingId(a), target_type: b, source: thingId(c) };
    case 3:
      return { tic, type: 'pickup', item: thingId(a), item_type: b, toucher: thingId(c) };
    case 4:
      return { tic, type: 'shot', shooter: thingId(a), angle: degrees(b), slope: units(c), distance: units(d), missile: thingId(e) };
    case 5:
      return { tic, type: 'hit', shooter: thingId(a), target: thingId(b), target_type: c };
    case 6:
      return { tic, type: 'use', thing: thingId(a), line: b, special: c, side: d };
    case 7:
      return { tic, type: 'cross', thing: thingId(a), line: b, special: c, side: d };
    case 8:
      return { tic, type: 'sound', sfx: a, origin: SOUND_ORIGINS[b] ?? 'none', origin_id: b === 0 ? null : c };
    case 9:
      return { tic, type: 'roi_enter', tag: a, sector: b };
    case 10:
      return { tic, type: 'roi_exit', tag: a, sector: b };
    case 11:
      return { tic, type: 'death', killer: thingId(a) };
    case 12:
      return { tic, type: 'exit', secret: a !== 0 };
    default:
      return { tic, type: `unknown_${kind}` };
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
