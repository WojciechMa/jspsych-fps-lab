# jspsych-fps-lab

Behavioral experiments on the Doom engine, run as jsPsych trials in the browser and hosted as a
static site on GitHub Pages. The project plan and rules are in [AGENTS.md](AGENTS.md); planned
paradigms are in [docs/paradigms.md](docs/paradigms.md).

Status: M0. The WebAssembly engine plays the development IWAD (miniwad) in the browser.

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

Behind a TLS-intercepting proxy, npm may fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Setting
`NODE_OPTIONS=--use-system-ca` makes Node trust the operating system's certificates.

## Controls

WASD moves, the mouse turns, left click fires, E uses, 1–7 select weapons. The player always
runs. Esc releases the mouse and pauses the game; game time stops while paused.

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
- Build tools that are not shipped: emscripten, deutex, [wadptr](https://github.com/fragglet/wadptr)
  (GPL-2.0), Vite, TypeScript.
