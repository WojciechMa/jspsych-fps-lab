# jspsych-fps-lab

Behavioral experiments on the Doom engine, run as jsPsych trials in the browser and hosted as a
static site on GitHub Pages. The project plan and rules are in [AGENTS.md](AGENTS.md); planned
paradigms are in [docs/paradigms.md](docs/paradigms.md).

Status: M2, version 0.0.2. A Doom map runs as a jsPsych trial (`doom-trial` plugin);
researcher-selected measures turn the play into data, and the start screen lists what they record.
The data can be downloaded as JSON at the end. Nothing is uploaded yet (DataPipe comes in M3). The
public site plays MAP01 of Freedoom Phase 2: the full IWAD, gzipped (about 11 MB), until the
trimmed IWAD of M4 exists.

## Build and run

Requirements: Node.js 24 (see `.nvmrc`) and Podman or Docker for the engine build.

```sh
npm ci
npm run build:engine   # compiles engine/ to src/engine/build in the pinned emscripten image
npm run dev            # http://localhost:5173
npm test               # measure and stream-decoder tests on synthetic data (Vitest)
npm run build          # type-check + production build in dist/
```

`npm run build:miniwad` rebuilds `public/wads/miniwad.wad` from source (deutex + wadptr in a
Debian container). The container tool is picked automatically; set `CONTAINER_ENGINE=podman` or
`docker` to force one.

`npm run dev` plays miniwad, which has no monsters and is meant for development and tests only;
`?iwad=freedoom2.wad` loads another IWAD from `public/wads` instead, e.g. Freedoom Phase 2 copied
there (git-ignored). Production builds load `wads/freedoom2.wad.gz`, which the Pages workflow
downloads from the pinned Freedoom release and gzips.

Behind a TLS-intercepting proxy, npm may fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Setting
`NODE_OPTIONS=--use-system-ca` makes Node trust the operating system's certificates.

## Controls

WASD moves, the mouse turns, left click fires, E uses, 1–7 select weapons. The player always
runs. Esc releases the mouse and pauses the game, as does switching to another window; game time
stops while paused.

## Recorded data

Only the active measures' outputs are stored. A `doom-trial` takes `measures`: measure ids or
`{ id, params }` objects (default: all of them). Its data row holds:

- the trial: `paradigm`, `mode`, `seed`, `input_profile`, `map`, `skill`, `time_limit`,
  `no_monsters`, `sound`;
- the outcome: `end_reason` (`exit`, `secret_exit`, `death`, `timeout`, `aborted` or `error`),
  `duration_tics`, `player_id`, `unadjusted_movement`, `stream_dropped` (should be 0);
- `measures`: id, version and parameters of each active measure;
- `results`: per measure id, `{ summary, raw }` (or `{ error }` if the measure failed);
- `engine`: SHA-256 of the `.wasm`, the git commit and the WAD hashes.

| Measure | Summary | Raw |
|---|---|---|
| `session_quality` | frame times, dropped frames, pauses by cause | pauses (frame intervals optional) |
| `input_log` | event counts | game keys, mouse buttons and mouse moves with `event.timeStamp` |
| `trajectory` | path length, speed, turning, coverage, revisits, teleports | x, y, angle per tic |
| `roi` | visits and time per ROI tag (sectors tagged 900–999) | enter/exit tics |
| `threat_rt` | monsters seen, median reaction times | per monster: first visible frame, whether the view was already turning toward it, turn-toward, first shot, hit, kill (and whether by the player) |
| `aiming` | discharges, accuracy, median angular error | per discharge: weapon, pellets, hits, target, error |
| `risk` | damage taken by source, hazard-floor crossings, engagements at low health | engagements |
| `demo` | format, size, mode/params/seed, engine and WAD hashes | the Doom 1.91 (`-longtics`) demo, base64 |

Every threshold is a measure parameter with a documented default; see `paramsSchema` in
`src/measures/*.ts`. Tables are stored as columns. Positions are in map units, angles in degrees
counter-clockwise from east, times in ms on the `performance.now()` clock; reaction times are also
given in tics, which pauses don't affect. Thing ids are stable within a trial; monster `type` is
Doom's `mobjtype_t` number (`engine/doomgeneric/info.h`).

## Timing

The engine runs at Doom's fixed rate of 35 tics per second (one tic ≈ 28.6 ms). Input is read
once per tic and the screen only changes when a tic has run, so engine-side events have tic
resolution even on faster displays.

## Licenses

- This project: GNU GPL, version 2 or (at your option) any later version. The GPL v2 text is in
  [LICENSE](LICENSE).
- Engine: [doomgeneric](https://github.com/ozkl/doomgeneric) (GPL-2.0-or-later), vendored in
  `engine/doomgeneric` at the commit recorded in `engine/UPSTREAM`. Our changes are marked with
  `jspsych-fps-lab:` comments.
- Development IWAD: [miniwad](https://github.com/fragglet/miniwad), BSD-3-Clause, see
  [public/wads/miniwad-LICENSE.txt](public/wads/miniwad-LICENSE.txt).
- Public demo IWAD: [Freedoom](https://github.com/freedoom/freedoom) Phase 2 v0.13.0,
  BSD-3-Clause. The Pages workflow publishes its license and credits next to it as
  `wads/freedoom-COPYING.txt` and `wads/freedoom-CREDITS.txt`.
- Build tools that are not shipped: emscripten, deutex, [wadptr](https://github.com/fragglet/wadptr)
  (GPL-2.0), Vite, TypeScript, Vitest.
