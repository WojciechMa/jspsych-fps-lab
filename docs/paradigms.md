# Paradigm backlog

Candidate paradigms for the paradigm registry (see AGENTS.md, "Paradigms"). Every paradigm runs
as a jsPsych trial; "mode" means paradigm-specific game rules inside the engine.

| # | id | Paradigm | What it studies | Needs | Main measures | Status |
|---|---|---|---|---|---|---|
| 1 | classic | Classic Doom level | Free play, general skill | Nothing extra (mode 0) | trajectory, aiming, risk, threat_rt | Playable as a jsPsych trial (M1) with all MVP measures (M2) |
| 2 | maze | Maze / route learning | Spatial learning, wayfinding, shortcuts | Maps only | trajectory, roi | In progress (M4): seeded maze generator, five maps in `maze.wad` (practice 3×3, two 6×6, two 9×9), study [maze-demo](../public/studies/maze-demo.json); counterbalancing of the variants still open |
| 3 | hidden-goal | Hidden-goal arena (virtual Morris water maze) | Spatial memory from distant landmarks | Maps + "goal reached" end condition | trajectory, roi | Planned |
| 4 | threat-corridor | Threat reaction corridor | Threat detection, how fast people turn toward a threat | Maps + mode 1 (seeded spawns) | threat_rt, aiming | In progress (M4): engine mode 1 spawns monsters one at a time at seeded spots and delays (passive by default), two corridors in `threat-corridor.wad`, study [threat-demo](../public/studies/threat-demo.json) |
| 5 | two-door-bandit | Two-door bandit | Explore vs exploit, reward learning | Map + mode 2 (seeded rewards; fixed probabilities with reversals, or drifting) | roi, bandit | In progress (M4): engine mode 2 with choice/return events, `two-door-bandit.wad`, `bandit` measure, study [bandit-demo](../public/studies/bandit-demo.json) |
| 6 | foraging | Foraging / patch leaving | When to leave a patch that is running out | Mode: items run out per patch | trajectory, roi, pickups | Planned |
| 7 | approach-avoid | Approach–avoidance conflict | Weighing reward against threat | Maps (reward next to a hazard or monster) | risk, roi | Planned |
| 8 | shoot-dont-shoot | Shoot / don't shoot | Impulse control, friend vs foe | New sprites in the IWAD + mode for friendly targets and penalties | aiming, threat_rt | Planned |
| 9 | visual-search | Visual search in 3D | Search efficiency, distraction | Maps or mode (target among distractors) | threat_rt (first visible), trajectory | Planned |

On hold: multiplayer and mobile/touch (AGENTS.md, "Side projects").
