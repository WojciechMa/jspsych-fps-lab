// jspsych-fps-lab: paradigm modes (dg_mode.c). Unlike the hooks in dg_hooks.h, modes change the
// game, but only deterministically: from map, skill, params, the trial seed and the ticcmds.

#ifndef DG_MODE_H
#define DG_MODE_H

#include <stdint.h>

struct mobj_s;

#define DG_MODE_PARAMS 16

enum { DG_MODE_CLASSIC = 0, DG_MODE_THREAT = 1, DG_MODE_BANDIT = 2 };

// Called by dg_start_trial after the level is loaded.
void DG_ModeStart(int mode, uint32_t seed);
// Called by P_Ticker once per tic, after the thinkers ran.
void DG_ModeTicker(void);
// Whether the mode's own end condition is met.
int DG_ModeDone(void);

// dg_trial.c records each spawn as an event.
void DG_OnModeSpawn(struct mobj_s *mo, int index, int spot);
// Bandit choices (door 0 = left, 1 = right; probabilities in FRACUNIT) and returns to the start.
void DG_OnModeChoice(int index, int door, int reward, int p_left, int p_right);
void DG_OnModeReturn(int next_index);

#endif
