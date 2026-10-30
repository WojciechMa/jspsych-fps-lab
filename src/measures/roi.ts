// roi: when the player enters and leaves regions of interest (sectors tagged 900–999).
import type { Measure } from './types';
import { toColumns } from './util';

interface Visit {
  tag: number;
  sector: number;
  enter_tic: number;
  /** First tic outside; the trial's end if the player was still inside. */
  exit_tic: number | null;
}

export const roi: Measure<Record<string, never>> = {
  id: 'roi',
  version: '1.0.0',
  label: 'Regions of interest',
  participantDescription: 'When you enter and leave marked areas of the level.',
  needs: ['events'],
  estBytesPerMin: 500,
  paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  create() {
    const visits: Visit[] = [];

    return {
      onEvent(event) {
        if (event.type === 'roi_enter') {
          visits.push({ tag: event.tag, sector: event.sector, enter_tic: event.tic, exit_tic: null });
        } else if (event.type === 'roi_exit') {
          for (let i = visits.length - 1; i >= 0; i--) {
            if (visits[i].tag === event.tag && visits[i].exit_tic === null) {
              visits[i].exit_tic = event.tic;
              break;
            }
          }
        }
      },
      finish(end) {
        const byTag: Record<string, { visits: number; tics: number; first_enter_tic: number }> = {};
        for (const visit of visits) {
          visit.exit_tic ??= end.durationTics;
          const tag = (byTag[visit.tag] ??= { visits: 0, tics: 0, first_enter_tic: visit.enter_tic });
          tag.visits++;
          tag.tics += visit.exit_tic - visit.enter_tic;
        }
        return {
          summary: { visits: visits.length, by_tag: byTag },
          raw: toColumns(visits, ['tag', 'sector', 'enter_tic', 'exit_tic']),
        };
      },
    };
  },
};
