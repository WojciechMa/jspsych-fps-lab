# jspsych-fps-lab: jsPsych + Doom-engine behavioral experiments (static site on GitHub Pages)


## Goal
Use the Doom engine as a platform for behavioral paradigms that run as jsPsych 8 trials; plain
Doom levels are one paradigm among several. Researcher-selectable "measures" log behavior. A study
config picks paradigms, maps and measures; participants see exactly what is recorded.

## Fixed decisions
- Engine: ozkl/doomgeneric vendored into engine/ (upstream commit pinned) and modified there. Our
  own platform layer replaces the SDL port: canvas output, keyboard/mouse/clock fed from JS, Web
  Audio sound effects, no SDL. Single-threaded (GitHub Pages can't send COOP/COEP headers).
- Repo: public on GitHub; license GPL-2.0-or-later (as in the doomgeneric source headers). LICENSE
  holds the GPL v2 text; README and package.json state "or later".
- Game data: no id Software WADs. Doom II mode (MAP01–MAP32). miniwad for development and tests
  only, never on the public page; participants get a trimmed IWAD built by script from Freedoom
  Phase 2 (BSD-3). Until it exists (M4), the public demo loads the full freedoom2.wad, gzipped by
  the Pages workflow (~11 MB, over budget). Our maps ship as PWADs with maps and wall textures
  only; new flats/sprites go into the IWAD. No music.
- Web: TypeScript + Vite + jsPsych 8.x, static build output. Node LTS installed locally
  (fallback: run Node in Podman).
- Data: @jspsych/extension-pipe (DataPipe, 32 MB/request) + local JSON/CSV download fallback.
- Builds: pinned emscripten/emsdk image; local builds use Podman, and the scripts must also work
  with Docker. CI: GitHub Actions builds engine + site and deploys to Pages. Pins: emsdk image in
  scripts/build-engine.mjs, Node in .nvmrc, upstream commits in engine/UPSTREAM and
  scripts/build-miniwad.mjs, Freedoom release in .github/workflows/pages.yml.
- Desktop only for now: keyboard + mouse, fullscreen, pointer lock; Chromium-based browsers and
  Firefox. Exclude mobile and Safari via plugin-browser-check (mobile: see Side projects).
- Controls: WASD move, mouse turn (vertical mouse motion ignored), left click fire, E use, always
  run, fixed sensitivity. Request unadjusted pointer-lock movement where supported and log
  whether it was granted.
- Verify every engine detail against the actual doomgeneric source; don't assume Chocolate Doom
  features exist.

## Upstream facts (verified 2026-10-23; our fork patches the traps)
- Emscripten port: SDL2 + SDL2_mixer (MIDI via Timidity), keyboard only (no mouse), driven by
  emscripten_set_main_loop. Its build has no WAD merging (-merge) and no net_* modules.
- -longtics (Doom 1.91 demo format, 5 bytes/tic) exists. Recording without it sets lowres_turn,
  which snaps live turning to 1.41° steps.
- G_CheckDemoStatus() ends recording with I_Error(). Reached by the demo-quit key ('q') and by a
  full demo buffer (128 KiB while vanilla_demo_limit = 1).
- P_Ticker freezes the world while the menu is open, but G_Ticker keeps recording ticcmds, so
  opening the menu desyncs replay.
- G_InitNew resets the RNG (M_ClearRandom). Single-player death reloads the level (G_DoReborn).
- miniwad is a Doom II IWAD with placeholder MAP01–MAP32 and no release download: build it with
  deutex from its repo.

## Engine changes
Hooks only observe. Control and paradigm patches may change behavior, but replaying the demo with
the same mode, params and seed must reproduce the trial exactly.
- Stable ids for every mobj, assigned at spawn (sequential per trial).
- Per tic, into a ring buffer in WASM memory that JS drains each frame: tic number, player x/y/z,
  angle, momentum, health, armor, ammo, weapon, sector index + tag, kill/item/secret counts, and
  id/x/y/z/angle/health of every monster that is awake or drawn.
- Events (EM_JS): damage (source, inflictor, target, amount), kill, pickup, shot, hit,
  use/linedef cross, ROI enter/exit, sound start (sfx, source id), player death, level exit.
- Per frame: pixel count and sector light level of each monster actually drawn (columns drawn
  after clipping, not just projected sprites) → "first visible" events.
- Hooks never call P_Random/M_Random or change game state.
- Control API: start_map(map, skill, flags, mode, params, seed), pause, resume, input on/off.
  One engine instance per page, reused across trials. Every trial starts with G_InitNew (pistol
  start). Exit/death/timeout/end condition ends the trial (no intermission, no respawn).
- Pause = freeze the engine clock so no tics run. During trials, disable Esc/menu, Doom's pause
  key, F-keys, screen-size keys, cheats, save/load, quit and the demo-quit key. Automap/HUD
  configurable.
- Per-trial demo recording with -longtics and an unlimited buffer, read from MEMFS, saved with
  the engine build hash (SHA-256 of the .wasm + engine commit) and SHA-256 of each WAD.
- The engine gets input only from our JS input adapter while a trial runs; nothing leaks into
  other trials (it breaks survey text fields).
- Resume the AudioContext after a user gesture.

## Paradigms
- Backlog with status: docs/paradigms.md. Keep it updated when a paradigm starts or ships.
- Registry like measures: { id, version, label, participantInstructions, mode, paramsSchema,
  maps, endConditions, defaultMeasures }. "classic" (plain Doom, mode 0) is one paradigm.
- Paradigm game logic lives in engine/ behind a mode id + params passed to start_map; mode 0 is
  unmodified Doom.
- Mode logic is deterministic: it may depend only on map, skill, params, the trial seed and
  ticcmds. Its randomness comes from its own seeded PRNG, never P_Random/M_Random. Demos of
  non-zero modes replay only in our engine.
- Trial-to-trial variation = pre-generated map variants, or params + a seed (fixed in the config
  or drawn per participant, always recorded). No unrecorded runtime randomness.
- Maps: generated by script (node builder such as ZDBSP or AJBSP in the build container) or drawn
  in Ultimate Doom Builder / SLADE. ROIs = sectors tagged 900–999, never targeted by linedef
  specials. A build script writes wads/manifest.json (SHA-256, size, maps, ROI names).

## Measures
Interface: { id, version, label, participantDescription, needs[], estBytesPerMin, paramsSchema,
             create(ctx, params) → { onTic?, onEvent?, onFrame?, finish() → { summary, raw? } } }
MVP set:
1. session_quality: frame times, dropped frames, blur/focus, fullscreen/pointer-lock exits, pauses
2. input_log: raw key/mouse events during trials only, on the performance.now() clock
   (event.timeStamp), passive capture listeners
3. trajectory: x/y/angle per tic (columnar), path length, coverage, revisits
4. roi: enter/exit times for ROI sectors
5. threat_rt: first visible → first turn-toward / shot / hit, per monster
6. aiming: shots, hits, accuracy, angular error at shot
7. risk: damage taken, hazard-floor crossings, engagements at low health
8. demo: base64 demo + hashes + mode/params/seed
Every threshold or definition (visible pixels, turn-toward, aiming target, engagement, low-health
cut-off, coverage grid) is a measure parameter with a documented default; M2 proposes the defaults
for review. Each trial records paradigm, mode, seed, input profile, and the active measures with
versions and params.

## Study configs
- public/studies/<id>.json, loaded via ?study=<id> (id must match ^[a-z0-9-]+$), validated
  against a JSON schema; fail loudly.
- Fields: title, consent HTML, allowed devices (default desktop), WAD set, practice, blocks of
  trials (paradigm, map, skill, params, seed, time limit, end conditions, measures + params,
  HUD/automap/sound flags), questionnaires, save settings, URL params to store, completion URL,
  optional counterbalancing via DataPipe condition assignment.
- The WAD set is fixed per study and loaded at engine boot; trials only pick maps, and the
  validator rejects duplicate map names. Trials ≤ 15 min; time limits count game tics, so pauses
  don't count.
- Questionnaires use the light jsPsych survey plugins, not the SurveyJS-based plugin-survey.
- builder.html: tick paradigms/maps/measures → preview participant-facing list + estimated data
  size → export JSON to commit.
- URL params (e.g., participant ids) are stored as data only, never injected into HTML.

## Participant flow
consent (auto-lists active measures) → browser check → fullscreen → instructions → practice →
trials → questionnaires → "your data" preview + download → upload or withdraw → debrief.
- Blur, fullscreen exit or pointer-lock loss pauses the trial; a click resumes it.
- extension-pipe streams (stream: true): each finished trial is staged on DataPipe. A completed
  session submits the full dataset at the end; that is the real data, and DataPipe then discards
  the staged copy. Sessions that stop early come back as .partial.json files: debugging only,
  never analyzed. The consent text says data is recorded during the session and incomplete
  sessions are kept for debugging.
- Withdrawing at the preview submits only a "withdrawn" marker instead of the data, which also
  discards the staged copy. Each request stays < 32 MB: large raw streams are uploaded as
  separate per-trial files.

## Budgets & docs
Engine + web ≤ 3 MB, default WAD ≤ 5 MB (gzipped transfer sizes), loading progress bar. README
documents licenses of all assets and timing limits (35 Hz tics).

## Milestones (stop for review after each)
M0 vendored doomgeneric with our platform layer + miniwad runs locally (Podman build) and on
   Pages via Actions.
M1 hooks + jsPsych plugin; trial ends on exit/death/timeout; JSON download.
M2 measure registry + MVP measures + auto consent list; Vitest tests on synthetic streams.
M3 study configs, schema, builder page, DataPipe.
M4 paradigm registry + engine modes; first paradigms with custom maps: maze navigation,
   threat-RT corridor, two-door bandit; trimmed Freedoom IWAD.
M5 offline replay (Node CLI, also used by CI): demo + WADs + mode/params/seed → recomputed
   engine-derived measures; must match live data (input_log and session_quality excluded).

## Side projects (after M5: keep them possible, don't build them yet)
- Multiplayer (2–4 players): the emscripten build has no net_* modules, so Chocolate Doom's
  lockstep net layer would have to be re-added on top of WebRTC. That needs a signaling/relay
  server GitHub Pages can't host (third-party or self-hosted: ask first). Lockstep gives all
  players one exact demo. Keep the input → ticcmd path independent of the transport.
- Mobile/touch: touch vs mouse makes aiming/RT data non-comparable, and phones lack pointer lock
  (iPhone also lacks element fullscreen). Keep it possible: JS input adapters feed abstract
  move/turn/buttons, each trial records input profile + device, studies declare allowed devices.
  Never pool device types in one analysis.

Ask before adding third-party services, collecting identifying data, or changing the license.