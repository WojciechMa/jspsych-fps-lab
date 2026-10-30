// Decodes the engine's record stream (engine/web/dg_trial.c). Records are int32 words:
// [type, length, payload...]; JS drains the stream after every engine call.
import type { EndReason, FrameState, GameEvent, MonsterState, TicState } from './types';

// Keep in sync with engine/web/dg_trial.c.
const REC_TIC = 1;
const REC_EVENT = 2;
const REC_FRAME = 3;
const REC_VISIBLE = 4;
const REC_END = 5;
const REC_START = 6;
const TIC_WORDS = 26;
const MONSTER_WORDS = 7;

const END_REASONS: readonly (EndReason | null)[] = [null, 'exit', 'secret_exit', 'death', 'timeout', 'aborted'];
const SOUND_ORIGINS = ['none', 'thing', 'sector'] as const;

export interface StreamSink {
  onStart(playerId: number): void;
  onTic(tic: TicState): void;
  onEvent(event: GameEvent): void;
  onFrame(frame: FrameState): void;
  onEnd(reason: EndReason, tic: number): void;
}

const units = (fixed: number): number => fixed / 65536;
const degrees = (bam: number): number => ((bam >>> 0) / 2 ** 32) * 360;
const thingId = (id: number): number | null => (id === 0 ? null : id);

export class StreamDecoder {
  // The frame being drawn: its visibility records follow the frame record.
  private frame: FrameState | null = null;

  constructor(private readonly sink: StreamSink) {}

  /**
   * Decodes one drained chunk. callTime is when the engine call that wrote it began; frameTimes
   * holds when each frame of that call was drawn.
   */
  add(words: Int32Array, callTime: number, frameTimes: ReadonlyMap<number, number>): void {
    let i = 0;
    while (i + 2 <= words.length) {
      const type = words[i];
      const p = i + 2;
      if (type !== REC_VISIBLE) this.flushFrame();
      switch (type) {
        case REC_START:
          this.sink.onStart(words[p]);
          break;
        case REC_TIC:
          this.sink.onTic(decodeTic(words, p, callTime));
          break;
        case REC_EVENT:
          this.sink.onEvent(decodeEvent(words, p));
          break;
        case REC_FRAME:
          this.frame = {
            frame: words[p],
            tic: words[p + 1],
            timeMs: frameTimes.get(words[p]) ?? callTime,
            visible: [],
          };
          break;
        case REC_VISIBLE:
          this.frame?.visible.push({
            id: words[p],
            type: words[p + 1],
            pixels: words[p + 2],
            light: words[p + 3],
            shadow: words[p + 4] !== 0,
            x: units(words[p + 5]),
            y: units(words[p + 6]),
          });
          break;
        case REC_END:
          this.sink.onEnd(END_REASONS[words[p]] ?? 'aborted', words[p + 1]);
          break;
      }
      i = p + words[i + 1];
    }
    this.flushFrame();
  }

  private flushFrame(): void {
    const frame = this.frame;
    if (!frame) return;
    this.frame = null;
    this.sink.onFrame(frame);
  }
}

function decodeTic(w: Int32Array, p: number, timeMs: number): TicState {
  const count = w[p + 25];
  const monsters: MonsterState[] = [];
  for (let k = 0; k < count; k++) {
    const q = p + TIC_WORDS + k * MONSTER_WORDS;
    monsters.push({
      id: w[q],
      type: w[q + 1],
      x: units(w[q + 2]),
      y: units(w[q + 3]),
      z: units(w[q + 4]),
      angle: degrees(w[q + 5]),
      health: w[q + 6],
    });
  }
  return {
    tic: w[p],
    timeMs,
    x: units(w[p + 1]),
    y: units(w[p + 2]),
    z: units(w[p + 3]),
    angle: degrees(w[p + 4]),
    momX: units(w[p + 5]),
    momY: units(w[p + 6]),
    momZ: units(w[p + 7]),
    health: w[p + 8],
    armor: w[p + 9],
    weapon: w[p + 10],
    ammo: [w[p + 11], w[p + 12], w[p + 13], w[p + 14]],
    sector: w[p + 15],
    sectorTag: w[p + 16],
    kills: w[p + 17],
    items: w[p + 18],
    secrets: w[p + 19],
    forward: w[p + 20],
    side: w[p + 21],
    // angleturn: 65536 units per full turn.
    turn: (w[p + 22] / 65536) * 360,
    buttons: w[p + 23],
    sectorSpecial: w[p + 24],
    monsters,
  };
}

function decodeEvent(w: Int32Array, p: number): GameEvent {
  const [kind, tic, a, b, c, d, e] = w.subarray(p, p + 7);
  switch (kind) {
    case 1:
      return { tic, type: 'damage', target: thingId(a), inflictor: thingId(b), source: thingId(c), amount: d, healthAfter: e };
    case 2:
      return { tic, type: 'kill', target: thingId(a), targetType: b, source: thingId(c) };
    case 3:
      return { tic, type: 'pickup', item: thingId(a), itemType: b, toucher: thingId(c) };
    case 4:
      return { tic, type: 'shot', shooter: thingId(a), angle: degrees(b), slope: units(c), distance: units(d), missile: thingId(e) };
    case 5:
      return { tic, type: 'hit', shooter: thingId(a), target: thingId(b), targetType: c, monster: d !== 0 };
    case 6:
      return { tic, type: 'use', thing: thingId(a), line: b, special: c, side: d };
    case 7:
      return { tic, type: 'cross', thing: thingId(a), line: b, special: c, side: d };
    case 8:
      return { tic, type: 'sound', sfx: a, origin: SOUND_ORIGINS[b] ?? 'none', originId: b === 0 ? null : c };
    case 9:
      return { tic, type: 'roi_enter', tag: a, sector: b };
    case 10:
      return { tic, type: 'roi_exit', tag: a, sector: b };
    case 11:
      return { tic, type: 'death', killer: thingId(a) };
    case 12:
      return { tic, type: 'exit', secret: a !== 0 };
    default:
      return { tic, type: 'unknown', kind };
  }
}
