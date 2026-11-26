# jspsych-fps-lab

Behavioral experiments on the Doom engine, run as jsPsych trials in the browser. The public demo is
a static site on GitHub Pages; real studies run on a lab-hosted [JATOS](https://www.jatos.org)
server. The project plan and rules are in [AGENTS.md](AGENTS.md); planned paradigms are in
[docs/paradigms.md](docs/paradigms.md).

Status: M4 in progress, version 0.0.3. A Doom map runs as a jsPsych trial (`doom-trial` plugin);
researcher-selected measures turn the play into data, and the consent page lists what they record.
A study config picks the trials, measures and save target: download (the only target on Pages) or
JATOS. DataPipe is planned as an alternative but not implemented yet. The public site plays MAP01
of Freedoom Phase 2 from a trimmed IWAD (4.7 MB gzipped).
The paradigms besides plain Doom so far are maze navigation (`?study=maze-demo`), the threat
reaction corridor (`?study=threat-demo`) and the two-door bandit (`?study=bandit-demo`).

## Build and run

Requirements: Node.js 24 (see `.nvmrc`) and Podman or Docker for the engine build.

```sh
npm ci
npm run build:engine   # compiles engine/ to src/engine/build in the pinned emscripten image
npm run dev            # http://localhost:5173
npm test               # measure, stream-decoder, study-config, builder, map and IWAD tests (Vitest)
npm run build          # type-check + production build in dist/
```

`npm run build:miniwad` rebuilds `public/wads/miniwad.wad` from source (deutex + wadptr in a
Debian container). The container tool is picked automatically; set `CONTAINER_ENGINE=podman` or
`docker` to force one.

`npm run build:maps` builds our map WADs from `maps/*.json` (seeded mazes from
[scripts/lib/maze.mjs](scripts/lib/maze.mjs), corridors from
[scripts/lib/corridor.mjs](scripts/lib/corridor.mjs) and the bandit room from
[scripts/lib/bandit.mjs](scripts/lib/bandit.mjs); nodes by ZDBSP in a Debian container) into
`public/wads/`, and writes [public/wads/manifest.json](public/wads/manifest.json) with each WAD's
SHA-256, its maps (slot, name, paradigm, ROI names) and their layouts (mazes: seed, cells, start,
goal, shortest route; corridors: length and the spawn spots; bandit: player start and doors). The same input gives the same
bytes; commit the WADs and the manifest. A maze cell is 128 map units with 16-unit walls; the
start cell is ROI tag 900, the goal cell tag 901, and entering the goal cell exits the level. A
corridor is 256 units wide, with the player near its south end facing north; alcoves (128 wide,
96 deep) sit behind and ahead of the player and in pairs along both sides, each with a spawn spot
(thing 14) just inside its mouth, so a monster there is visible from anywhere in the corridor.
The bandit map is a start room (640 × 384, ROI 900) with two identical doorways in its north wall,
each a 128-wide, 32-deep passage into a room behind it (ROI 901 left, 902 right); the player
starts on its centre line facing north, with each door about 34° to the side.

`npm run dev` plays the same IWAD as production builds, `wads/freedoom2-lab.wad.gz`: Freedoom
Phase 2 trimmed by `npm run build:iwad` ([scripts/build-iwad.mjs](scripts/build-iwad.mjs)) from
`public/wads/freedoom2.wad`. `npm run fetch:freedoom` downloads that file and Freedoom's licence
files from the release pinned in [src/paradigms/iwad.json](src/paradigms/iwad.json) and checks
their SHA-256; all of them are git-ignored. Local setup and the workflows (via
[.github/actions/add-freedoom](.github/actions/add-freedoom/action.yml)) run the same two steps:

```sh
npm run fetch:freedoom   # once; skipped if public/wads already has the pinned release
npm run build:iwad
```

`iwad.json` also pins the output SHA-256 and lists the classic levels the trimmed IWAD keeps (MAP01, MAP02, MAP06; MAP01 is
required, since the engine boots into it); classic trials can only use those. Everything else
leaves: the other levels, music (the engine plays none), demos, and every wall texture, patch and
flat that neither those levels nor the map WADs in the manifest use. Switch textures, animation
cycles (whole), the three skies and the flats the engine loads by name stay. The same input gives
the same bytes; if the output changes on purpose (other levels, new textures in a map WAD), run
`npm run build:iwad -- --update` and commit the new hash. miniwad (no monsters, placeholder
graphics) is for tests only; in `npm run dev`, `?iwad=miniwad.wad` loads it, or any other
uncompressed IWAD from `public/wads` (e.g. the full `freedoom2.wad`). Production builds leave
miniwad and the full Freedoom IWAD out.

### Study configs

A study is a JSON file `public/studies/<id>.json`, checked against
[public/studies/schema.json](public/studies/schema.json) when the page loads; any problem stops
the page with a list of all of them. The page loads `?study=<id>` (default `demo`), or in JATOS
the study named in the component's JSON input. [demo.json](public/studies/demo.json) is the Pages
demo (download only); [jatos-demo.json](public/studies/jatos-demo.json) saves to JATOS;
[maze-demo.json](public/studies/maze-demo.json) is a practice maze and two test mazes;
[threat-demo.json](public/studies/threat-demo.json) a practice corridor and two test corridors;
[bandit-demo.json](public/studies/bandit-demo.json) a practice round and a fixed (one reversal)
and a drifting bandit round.

Map WADs: `wads` lists WADs from the manifest, loaded after the IWAD at boot (their maps replace
those slots). A trial's `paradigm` (default `classic`) decides which maps it may use: `classic`
plays IWAD slots no listed WAD replaces, the others play maps built for them. Each paradigm has
its own instructions (the trial's start prompt unless `prompt_html` is set) and default measures
(maze: session_quality, input_log, trajectory, roi, demo; threat-corridor: session_quality,
input_log, trajectory, threat_rt, aiming, demo; two-door-bandit: session_quality, input_log,
trajectory, roi, bandit, demo).

Paradigms with engine rules take `params` (checked against the paradigm's schema; defaults fill
the rest) and a `seed` (0–4294967295) for their random draws. Without `seed`, each participant
gets a random one; it is always recorded, and the same mode, params and seed replay the trial
exactly. `threat-corridor` (engine mode 1) spawns `threats` monsters (default 10) one at a time at
random spots of the corridor, each `min_delay_s`–`max_delay_s` seconds (default 2–5, uniform, in
whole tics) after the previous one died; the trial ends as `complete` when the last one is dead.
`monster` is `zombieman` (default), `shotgun_guy`, `imp` or `demon`; with `attack: false`
(default) monsters never wake up, turn or fire; `teleport_fog` (default on) shows the teleport
flash and sound at each spawn.

`two-door-bandit` (engine mode 2) counts a choice when the player steps into a doorway; its
reward is drawn from that door's probability and shown at once (point: the yellow pickup flash and
chime, plus `Score: n` unless `show_score: false` or `hud: false`; no point: the "oof" grunt).
The player then stands still for `feedback_s` (default 1 s) and is teleported back to the start,
facing north (teleport sound, no fog and no freeze). After `choices` choices (default 40) the trial
ends as `complete`. `schedule: "fixed"` (default) keeps `p_left`/`p_right` (default 0.7/0.3) but
swaps them after each choice number listed in `reversals` (up to 7); `schedule: "drifting"` (a
restless bandit) moves both after every choice by an independent, approximately Gaussian step
(`drift_sd`, default 0.025; sum of 12 uniforms) reflected at `drift_min`/`drift_max` (default
0.25/0.75). All draws come from the trial seed: the reward of each choice first, then the left and
the right step.

Participants see: content warning → consent (the recorded data and where it goes) → browser
check → full screen → how to play → the trials, each followed by a save step → questionnaires →
a summary of their data with submit, download or withdraw → end page. Declining at the warning or
the consent records nothing; so does failing the browser check (Chrome, Edge, Opera or Firefox on
a desktop or laptop with Web Audio and the fullscreen API; no phones, tablets or Safari). URL
parameters listed in `url_params` are stored as data (only those names, at most 200 characters
each).

Optional fields besides the trials: `fullscreen: false` skips the full-screen step (by default
leaving full screen pauses the game and a click goes back to it); `practice: true` marks a block's
trials as practice in the data; per trial, `hud: false` hides the status bar and pickup messages
(full-height view) and `automap: true` lets Tab open the automap; `questionnaires` are pages of
questions after the last block, one type per page (`likert`, `choice`, `multi_select`, `text`),
stored by answer name.

The study builder (`/builder.html`: http://localhost:5173/builder.html with `npm run dev`, or
under the Pages URL) writes these files without editing JSON by hand: pick the map WADs, the
trials (paradigm, map, skill, time limit), the measures and their parameters, questionnaires, and where the data goes. It shows the
problems the page would report, the estimated data size against the JATOS limits, and the
participant-facing pages (warning, consent with the recorded measures, instructions, trials,
questionnaires).
Download the JSON, save it as `public/studies/<id>.json` and commit it. Nothing is sent anywhere;
the draft stays in the browser's local storage. It can also open an existing config to edit it.
The builder is not packed into JATOS study archives.

### JATOS (local test server)

```sh
npm run jatos:local start             # JATOS in a container at http://localhost:9000 (admin / admin)
npm run build:jatos -- jatos-demo     # packs that study as dist-jatos/jspsych-fps-lab-jatos-demo-<version>.jzip
npm run jatos:local stop              # keeps the data volume; `reset` deletes it
```

In JATOS: Studies > + > Import study, pick the `.jzip`, then Study links > General Multiple to get
a participant link. Only studies with `save.target: "jatos"` and the `jatos` UUIDs can be packed;
the UUIDs stay fixed, so re-importing a new build updates the same JATOS study and keeps its
results. The archive holds the site, that one study config and the schema, the WAD manifest
and the study's map WADs, and needs
`freedoom2-lab.wad.gz`, `freedoom-COPYING.txt` and `freedoom-CREDITS.txt` in `public/wads`
(`npm run fetch:freedoom && npm run build:iwad`);
miniwad is not packed. The server listens on 127.0.0.1 only
because of the default login. JATOS serves `.wasm` as `application/octet-stream`, so the browser
logs a warning and compiles the engine without streaming; it still runs.

What JATOS stores per study run, after each trial: one line of result data (the trial's data row
with the measure summaries, as NDJSON) and the raw streams as files `trial-NNN-<measure>.json`,
plus the demo as `trial-NNN-demo.lmp`. Screens before the trials (warning, consent) are sent with
the first trial. Submitting ends the run as FINISHED; withdrawing calls `abortStudy`, which deletes
the run's data and files (ABORTED). A run that stops early keeps what was sent so far but never
reaches FINISHED: use it for debugging only.

### Deploying a study to the lab JATOS

GitHub Pages only hosts the public demo; a study reaches JATOS through the manual workflow
[Deploy study to JATOS](.github/workflows/jatos.yml): Actions > Deploy study to JATOS > Run
workflow, enter the study id and pick the target. It builds the engine and the study's `.jzip`
(also kept as a run artifact for a manual import) and imports it with `POST
/jatos/api/v1/studies`, which overwrites the study with the same UUID and keeps its results.

Setup, once per JATOS server:

1. In JATOS, create a dedicated user for deployments and an API token for it (in that user's
   profile). The first import makes that user a member of the study; for a study imported earlier
   by someone else, add the user as a member first.
2. In GitHub, Settings > Environments, create an environment (e.g. `jatos-lab`) with required
   reviewers and the secrets `JATOS_URL` (`https://…`, the server's base URL) and `JATOS_TOKEN`.

Don't deploy while participants are running the study: the import replaces its files.

Behind a TLS-intercepting proxy, npm may fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. Setting
`NODE_OPTIONS=--use-system-ca` makes Node trust the operating system's certificates. If
downloads time out (`npm run fetch:freedoom`) because the network only allows traffic through a
proxy, also set `HTTPS_PROXY=http://<proxy>:<port>` and `NODE_USE_ENV_PROXY=1`.

## Controls

WASD moves, the mouse turns, left click fires, E uses, 1–7 select weapons. The player always
runs. Esc releases the mouse and pauses the game, as does switching to another window or leaving
full screen; game time stops while paused. Tab opens the automap only in trials with
`automap: true`.

## Recorded data

Only the active measures' outputs are stored. A `doom-trial` takes `measures`: measure ids or
`{ id, params }` objects (default: the paradigm's defaults; all of them for `classic`). Its data
row holds:

- the trial: `block`, `block_name`, `practice`, `paradigm`, `paradigm_version`, `mode`,
  `params`, `seed`, `input_profile`, `map`, `map_name` (from the WAD manifest), `skill`, `time_limit`, `no_monsters`, `sound`, `hud`, `automap`, `fullscreen`;
- the outcome: `end_reason` (`exit`, `secret_exit`, `death`, `timeout`, `complete` (the
  paradigm's goal is met), `aborted` or `error`),
  `duration_tics`, `player_id`, `unadjusted_movement`, `stream_dropped` (should be 0);
- `measures`: id, version and parameters of each active measure;
- `results`: per measure id, `{ summary, raw }` (or `{ error }` if the measure failed);
- `engine`: SHA-256 of the `.wasm`, the git commit and the hashes of the IWAD and map WADs.

| Measure | Summary | Raw |
|---|---|---|
| `session_quality` | frame times, dropped frames, pauses by cause (lost mouse, window blur, hidden page, full-screen exit) | pauses (frame intervals optional) |
| `input_log` | event counts | game keys (plus Tab with the automap), mouse buttons and mouse moves with `event.timeStamp` |
| `trajectory` | path length, speed, turning, coverage, revisits, teleports | x, y, angle per tic |
| `roi` | visits and time per ROI tag (sectors tagged 900–999) | enter/exit tics |
| `threat_rt` | monsters seen, median reaction times, monsters a paradigm spawned and how many of them were never seen | per monster: first visible frame, whether the view was already turning toward it, turn-toward, first shot, hit, kill (and whether by the player), spawn tic and spot (paradigm spawns only) |
| `aiming` | discharges, accuracy, median angular error | per discharge: weapon, pellets, hits, target, error |
| `risk` | damage taken by source, hazard-floor crossings, engagements at low health | engagements |
| `bandit` | choices, rewards, left share, share of choices of the better door, switches, win-stay and lose-shift rates, median choice time in tics | per choice: tic, start tic (trial start or return), choice time, door, reward, both probabilities, whether the door was the better one (null if equal) |
| `demo` | format, size, mode/params/seed, HUD/automap settings and the tics the automap opened or closed (replay needs them: the 3D view is off while it is open), engine and WAD hashes | the Doom 1.91 (`-longtics`) demo, base64 |

Other rows: `browser_check` (browser, version, OS, window size, screen refresh rate) and one
`questionnaire` row per page (`response`: answers by name; Likert answers are 0-based scale
indexes).

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
- Test IWAD: [miniwad](https://github.com/fragglet/miniwad), BSD-3-Clause, see
  [public/wads/miniwad-LICENSE.txt](public/wads/miniwad-LICENSE.txt).
- IWAD: [Freedoom](https://github.com/freedoom/freedoom) Phase 2 v0.13.0, BSD-3-Clause, trimmed
  by `npm run build:iwad` (a modified version: fewer levels, textures, patches and flats; no music
  or demos). The site publishes Freedoom's license and credits next to it as
  `wads/freedoom-COPYING.txt` and `wads/freedoom-CREDITS.txt`.
- Our maps (`maps/`, `public/wads/maze.wad`, `public/wads/threat-corridor.wad`,
  `public/wads/two-door-bandit.wad`): part of this
  project, GPL-2.0-or-later. They use
  only textures and flats of the IWAD.
- Build tools that are not shipped: emscripten, deutex, [wadptr](https://github.com/fragglet/wadptr)
  (GPL-2.0), [ZDBSP](https://zdoom.org/wiki/ZDBSP) (GPL-2.0-or-later, the Debian package), Vite,
  TypeScript, Vitest.
