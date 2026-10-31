// session_quality: how smoothly the game ran and when and why it paused.
import type { PauseCause } from '../engine/types';
import type { Measure } from './types';
import { median, percentile, round, toColumns } from './util';

interface Params {
  dropFactor: number;
  keepFrameTimes: boolean;
}

interface Pause {
  tic: number;
  cause: PauseCause;
  start_ms: number;
  duration_ms: number | null;
}

export const sessionQuality: Measure<Params> = {
  id: 'session_quality',
  version: '1.1.0',
  label: 'Session quality',
  participantDescription:
    'How smoothly the game ran on your computer, and when and why it paused (for example when you switched to another window).',
  needs: ['frames', 'page'],
  estBytesPerMin: 1_000,
  paramsSchema: {
    type: 'object',
    properties: {
      dropFactor: {
        type: 'number',
        default: 1.5,
        minimum: 1,
        description: 'A frame counts as dropped when its interval is longer than this multiple of the median interval.',
      },
      keepFrameTimes: {
        type: 'boolean',
        default: false,
        description: 'Also store every frame interval (one number per displayed frame).',
      },
    },
    additionalProperties: false,
  },
  create(_ctx, params) {
    const intervals: number[] = [];
    const pauses: Pause[] = [];
    let frames = 0;
    let lastFrameMs: number | null = null;

    return {
      onFrame(frame) {
        frames++;
        if (lastFrameMs !== null) intervals.push(frame.timeMs - lastFrameMs);
        lastFrameMs = frame.timeMs;
      },
      onPage(event) {
        if (event.type === 'pause') {
          pauses.push({ tic: event.tic, cause: event.cause, start_ms: round(event.timeMs, 1), duration_ms: null });
          // The next frame interval would span the pause.
          lastFrameMs = null;
          return;
        }
        const pause = pauses.at(-1);
        if (pause && pause.duration_ms === null) pause.duration_ms = round(event.timeMs - pause.start_ms, 1);
      },
      finish() {
        const typical = median(intervals);
        const dropped = typical === null ? 0 : intervals.filter((ms) => ms > params.dropFactor * typical).length;
        const byCause: Record<string, number> = {};
        for (const pause of pauses) byCause[pause.cause] = (byCause[pause.cause] ?? 0) + 1;
        const nullable = (value: number | null, decimals: number) => (value === null ? null : round(value, decimals));
        return {
          // Frames are drawn only when a tic has run, so the rate is at most 35 Hz, not the display's.
          summary: {
            frames,
            median_frame_ms: nullable(typical, 2),
            p95_frame_ms: nullable(percentile(intervals, 95), 2),
            max_frame_ms: nullable(intervals.length ? Math.max(...intervals) : null, 2),
            frame_rate_hz: typical ? round(1000 / typical, 1) : null,
            dropped_frames: dropped,
            pauses: pauses.length,
            pause_ms: round(pauses.reduce((sum, pause) => sum + (pause.duration_ms ?? 0), 0), 1),
            pauses_by_cause: byCause,
          },
          raw: {
            pauses: toColumns(pauses, ['tic', 'cause', 'start_ms', 'duration_ms']),
            frame_ms: params.keepFrameTimes ? intervals.map((ms) => round(ms, 2)) : null,
          },
        };
      },
    };
  },
};
