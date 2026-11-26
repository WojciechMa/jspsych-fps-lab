// bandit: the two-door bandit's choices, rewards and choice times (paradigm "two-door-bandit").
import type { Measure } from './types';
import { median, round, toColumns } from './util';

interface Choice {
  index: number;
  /** Tic the player entered the door's passage. */
  tic: number;
  /** Tic the choice became possible: 0, or the return to the start after the previous choice. */
  start_tic: number;
  choice_tics: number;
  door: 'left' | 'right';
  reward: boolean;
  p_left: number;
  p_right: number;
  /** Whether the chosen door had the higher reward probability; null when they were equal. */
  better: boolean | null;
}

function share(count: number, total: number): number | null {
  return total ? round(count / total, 4) : null;
}

export const bandit: Measure<Record<string, never>> = {
  id: 'bandit',
  version: '1.0.0',
  label: 'Door choices (bandit)',
  participantDescription: 'Which door you chose each time, whether it paid off, and how long you took to choose.',
  needs: ['events'],
  estBytesPerMin: 1500,
  paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  create() {
    const choices: Choice[] = [];
    let startTic = 0;

    return {
      onEvent(event) {
        if (event.type === 'return') {
          startTic = event.tic;
        } else if (event.type === 'choice') {
          const chosen = event.door === 'left' ? event.pLeft : event.pRight;
          const other = event.door === 'left' ? event.pRight : event.pLeft;
          choices.push({
            index: event.index,
            tic: event.tic,
            start_tic: startTic,
            choice_tics: event.tic - startTic,
            door: event.door,
            reward: event.reward,
            p_left: round(event.pLeft, 4),
            p_right: round(event.pRight, 4),
            better: chosen === other ? null : chosen > other,
          });
        }
      },
      finish() {
        let switches = 0, afterWin = 0, winStay = 0, afterLoss = 0, loseShift = 0;
        for (let i = 1; i < choices.length; i++) {
          const switched = choices[i].door !== choices[i - 1].door;
          if (switched) switches++;
          if (choices[i - 1].reward) {
            afterWin++;
            if (!switched) winStay++;
          } else {
            afterLoss++;
            if (switched) loseShift++;
          }
        }
        const rated = choices.filter((c) => c.better !== null);
        return {
          summary: {
            choices: choices.length,
            rewards: choices.filter((c) => c.reward).length,
            left_share: share(choices.filter((c) => c.door === 'left').length, choices.length),
            better_share: share(rated.filter((c) => c.better).length, rated.length),
            switches,
            win_stay: share(winStay, afterWin),
            lose_shift: share(loseShift, afterLoss),
            median_choice_tics: median(choices.map((c) => c.choice_tics)),
          },
          raw: toColumns(choices, [
            'index', 'tic', 'start_tic', 'choice_tics', 'door', 'reward', 'p_left', 'p_right', 'better',
          ]),
        };
      },
    };
  },
};
