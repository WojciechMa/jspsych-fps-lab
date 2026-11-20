// demo: the trial as a Doom 1.91 (-longtics) demo, with what is needed to replay it.
import type { Measure } from './types';
import { toBase64 } from './util';

export const demo: Measure<Record<string, never>> = {
  id: 'demo',
  // 1.1.0: hud, automap and automap_toggles added.
  version: '1.1.0',
  label: 'Replay (demo)',
  participantDescription:
    'A replay of your run: the game commands of every moment (moving, turning, firing), so the researchers can replay it exactly.',
  needs: ['demo'],
  // 5 bytes per tic, base64-encoded.
  estBytesPerMin: 14_000,
  paramsSchema: { type: 'object', properties: {}, additionalProperties: false },
  create(ctx) {
    // Tics at which the automap opened, closed, opened, …: not in the demo, but replay needs them
    // because the 3D view (and so monster visibility) is off while the map is open.
    const automapToggles: number[] = [];
    return {
      onEvent(event) {
        if (event.type === 'automap') automapToggles.push(event.tic);
      },
      finish(end) {
        const { trial } = ctx;
        return {
          summary: {
            format: 'doom-1.91-longtics',
            bytes: end.demo.length,
            tics: end.durationTics,
            paradigm: trial.paradigm,
            mode: trial.mode,
            params: trial.params,
            seed: trial.seed,
            map: trial.map,
            skill: trial.skill,
            no_monsters: trial.noMonsters,
            hud: trial.hud,
            automap: trial.automap,
            automap_toggles: automapToggles,
            engine: trial.engine,
          },
          raw: toBase64(end.demo),
        };
      },
    };
  },
};
