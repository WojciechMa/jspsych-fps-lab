// jspsych-fps-lab: hooks from the game code into the trial recorder (dg_trial.c).
// They only read game state: they never call P_Random/M_Random or change the simulation.

#ifndef DG_HOOKS_H
#define DG_HOOKS_H

struct mobj_s;
struct line_s;
struct vissprite_s;

void DG_OnSpawn(struct mobj_s *mobj);
void DG_OnDamage(struct mobj_s *target, struct mobj_s *inflictor, struct mobj_s *source, int damage);
void DG_OnKill(struct mobj_s *source, struct mobj_s *target);
void DG_OnPickup(struct mobj_s *item, struct mobj_s *toucher);
void DG_OnShot(struct mobj_s *shooter, unsigned int angle, int slope, int distance,
               struct mobj_s *missile);
void DG_OnHit(struct mobj_s *shooter, struct mobj_s *target);
void DG_OnUseLine(struct mobj_s *thing, struct line_s *line, int side);
void DG_OnCrossLine(struct mobj_s *thing, int linenum, int side);
void DG_OnSound(void *origin, int sfx_id);

// Tic loop: the world stands still while no trial runs; each completed tic is recorded.
int DG_TicsSuspended(void);
void DG_OnTicEnd(void);

// Renderer: returns the new frame's number; R_DrawMaskedColumn counts a sprite's drawn pixels.
int DG_OnFrameStart(void);
extern int dg_sprite_pixels;
void DG_OnSpriteDrawn(struct vissprite_s *vis, int pixels);

#endif
