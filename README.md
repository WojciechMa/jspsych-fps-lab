# jspsych-fps-lab

Behavioral experiments on the Doom engine, run as jsPsych trials in the browser and hosted as a
static site on GitHub Pages. The project plan and rules are in [AGENTS.md](AGENTS.md); planned
paradigms are in [docs/paradigms.md](docs/paradigms.md).

Status: M1. A Doom map runs as a jsPsych trial (`doom-trial` plugin) that records the play; the
data can be downloaded as JSON at the end. Nothing is uploaded yet (DataPipe comes in M3). The
public site plays MAP01 of Freedoom Phase 2: the full IWAD, gzipped (about 11 MB), until the
trimmed IWAD of M4 exists.

## Build and run

Requirements: Node.js 24 (see `.nvmrc`) and Podman or Docker for the engine build.

```sh
npm ci
npm run build:engine   # compiles engine/ to src/engine/build in the pinned emscripten image
npm run dev            # http://localhost:5173
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

Each `doom-trial` returns its settings and:

- `end_reason` (`exit`, `secret_exit`, `death`, `timeout`, `aborted` or `error`) and
  `duration_tics`.
- `tics`: one row per tic with position, view angle, momentum, health, armor, weapon, ammo,
  sector and sector tag, kill/item/secret counts, and the tic's movement, turning and buttons.
- `monsters`: per tic, each monster that is awake or was drawn in the last frame.
- `events`: damage, kill, pickup, shot, hit, use, line crossing, sound, ROI enter/exit, death
  and exit.
- `frames` and `visible`: each rendered frame, and the monsters actually drawn in it with their
  pixel count and sector light level.
- `pauses`: tic, cause and duration.
- `demo`: the whole trial as a Doom 1.91 (`-longtics`) demo, base64-encoded; `engine`: SHA-256
  of the `.wasm`, the git commit and the WAD hashes needed to replay it.

Tables are stored as columns. Positions are in map units, angles in degrees counter-clockwise
from east, times in ms on the `performance.now()` clock. Thing ids are stable within a trial.

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
  (GPL-2.0), Vite, TypeScript.
