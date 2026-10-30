// Trial control and recording. A trial starts a map from scratch, records it as a Doom 1.91
// (longtics) demo and streams per-tic state, events and sprite visibility to JS, which drains
// the stream after every engine call. Records are int32 words: [type, length, payload...].

#include <stdint.h>

#include <emscripten.h>

#include "d_main.h"
#include "doomstat.h"
#include "g_game.h"
#include "p_local.h"
#include "r_defs.h"
#include "r_state.h"
#include "z_zone.h"

#include "dg_hooks.h"

#define DEMOMARKER 0x80
#define STREAM_WORDS (1 << 18)
#define TIC_WORDS 26
#define MONSTER_WORDS 7
#define EVENT_WORDS 7
#define VISIBLE_WORDS 7
#define ROI_TAG_MIN 900
#define ROI_TAG_MAX 999

// Keep in sync with src/engine/stream.ts.
enum { REC_TIC = 1, REC_EVENT, REC_FRAME, REC_VISIBLE, REC_END, REC_START };
enum {
    EV_DAMAGE = 1, EV_KILL, EV_PICKUP, EV_SHOT, EV_HIT, EV_USE, EV_CROSS, EV_SOUND,
    EV_ROI_ENTER, EV_ROI_EXIT, EV_DEATH, EV_EXIT
};
enum { END_EXIT = 1, END_SECRET_EXIT, END_DEATH, END_TIMEOUT, END_ABORTED };
enum { TRIAL_IDLE, TRIAL_RUNNING, TRIAL_ENDED };

// Demo state lives in g_game.c.
extern byte *demobuffer;
extern byte *demo_p;
extern char *demoname;
extern boolean secretexit;

static int32_t stream[STREAM_WORDS];
static int stream_used;
static int stream_dropped;

static int trial_state = TRIAL_IDLE;
static int pending_end;
static int trial_tic;
static int tic_limit;
static int next_mobj_id;
static int frame_number;
static int last_roi_tag;
static int last_sector;
static int demo_length;

int dg_sprite_pixels;

static int32_t *Record(int type, int length)
{
    int32_t *record;

    if (stream_used + 2 + length > STREAM_WORDS)
    {
        stream_dropped++;
        return NULL;
    }

    record = &stream[stream_used];
    record[0] = type;
    record[1] = length;
    stream_used += 2 + length;
    return record + 2;
}

static void Event(int kind, int a, int b, int c, int d, int e)
{
    int32_t *r;

    if (trial_state != TRIAL_RUNNING)
        return;

    r = Record(REC_EVENT, EVENT_WORDS);
    if (r == NULL)
        return;

    r[0] = kind;
    r[1] = trial_tic;
    r[2] = a;
    r[3] = b;
    r[4] = c;
    r[5] = d;
    r[6] = e;
}

static int IdOf(mobj_t *mo)
{
    return mo != NULL ? mo->dg_id : 0;
}

static boolean IsMonster(mobj_t *mo)
{
    // Lost souls are monsters without MF_COUNTKILL.
    return ((mo->flags & MF_COUNTKILL) || mo->type == MT_SKULL) && mo->health > 0;
}

static boolean IsTrackedMonster(thinker_t *th)
{
    mobj_t *mo;

    if (th->function.acp1 != (actionf_p1) P_MobjThinker)
        return false;

    mo = (mobj_t *) th;
    return IsMonster(mo)
        && (mo->target != NULL || (frame_number > 0 && mo->dg_drawn_frame == frame_number));
}

static int RoiTag(int tag)
{
    return tag >= ROI_TAG_MIN && tag <= ROI_TAG_MAX ? tag : 0;
}

static void EndTrial(int reason)
{
    int32_t *r;

    *demo_p++ = DEMOMARKER;
    demo_length = demo_p - demobuffer;
    demorecording = false;
    trial_state = TRIAL_ENDED;

    r = Record(REC_END, 2);
    if (r != NULL)
    {
        r[0] = reason;
        r[1] = trial_tic;
    }
}

static void ReleaseDemo(void)
{
    if (demobuffer != NULL)
    {
        Z_Free(demobuffer);
        demobuffer = NULL;
    }
    if (demoname != NULL)
    {
        Z_Free(demoname);
        demoname = NULL;
    }
    demorecording = false;
    demo_length = 0;
}

static void RecordTic(void)
{
    player_t *player = &players[consoleplayer];
    mobj_t *mo = player->mo;
    sector_t *sector = mo->subsector->sector;
    int sector_index = sector - sectors;
    int roi = RoiTag(sector->tag);
    int count = 0;
    thinker_t *th;
    int32_t *r;
    int i;

    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        if (IsTrackedMonster(th))
            count++;
    }

    r = Record(REC_TIC, TIC_WORDS + count * MONSTER_WORDS);
    if (r != NULL)
    {
        r[0] = trial_tic;
        r[1] = mo->x;
        r[2] = mo->y;
        r[3] = mo->z;
        r[4] = (int32_t) mo->angle;
        r[5] = mo->momx;
        r[6] = mo->momy;
        r[7] = mo->momz;
        r[8] = player->health;
        r[9] = player->armorpoints;
        r[10] = player->readyweapon;
        for (i = 0; i < NUMAMMO; i++)
            r[11 + i] = player->ammo[i];
        r[15] = sector_index;
        r[16] = sector->tag;
        r[17] = player->killcount;
        r[18] = player->itemcount;
        r[19] = player->secretcount;
        r[20] = player->cmd.forwardmove;
        r[21] = player->cmd.sidemove;
        r[22] = player->cmd.angleturn;
        r[23] = player->cmd.buttons;
        r[24] = sector->special;
        r[25] = count;

        r += TIC_WORDS;
        for (th = thinkercap.next; th != &thinkercap; th = th->next)
        {
            if (!IsTrackedMonster(th))
                continue;
            mo = (mobj_t *) th;
            r[0] = mo->dg_id;
            r[1] = mo->type;
            r[2] = mo->x;
            r[3] = mo->y;
            r[4] = mo->z;
            r[5] = (int32_t) mo->angle;
            r[6] = mo->health;
            r += MONSTER_WORDS;
        }
    }

    if (roi != last_roi_tag)
    {
        if (last_roi_tag)
            Event(EV_ROI_EXIT, last_roi_tag, last_sector, 0, 0, 0);
        if (roi)
            Event(EV_ROI_ENTER, roi, sector_index, 0, 0, 0);
        last_roi_tag = roi;
    }
    last_sector = sector_index;
}

void DG_OnSpawn(mobj_t *mobj)
{
    mobj->dg_id = ++next_mobj_id;
}

void DG_OnDamage(mobj_t *target, mobj_t *inflictor, mobj_t *source, int damage)
{
    Event(EV_DAMAGE, IdOf(target), IdOf(inflictor), IdOf(source), damage, target->health - damage);
}

void DG_OnKill(mobj_t *source, mobj_t *target)
{
    Event(EV_KILL, IdOf(target), target->type, IdOf(source), 0, 0);

    if (target->player != NULL && trial_state == TRIAL_RUNNING)
    {
        Event(EV_DEATH, IdOf(source), 0, 0, 0, 0);
        if (!pending_end)
            pending_end = END_DEATH;
    }
}

void DG_OnPickup(mobj_t *item, mobj_t *toucher)
{
    Event(EV_PICKUP, IdOf(item), item->type, IdOf(toucher), 0, 0);
}

void DG_OnShot(mobj_t *shooter, unsigned int angle, int slope, int distance, mobj_t *missile)
{
    if (shooter->player != NULL)
        Event(EV_SHOT, IdOf(shooter), (int32_t) angle, slope, distance, IdOf(missile));
}

void DG_OnHit(mobj_t *shooter, mobj_t *target)
{
    if (shooter->player != NULL)
        Event(EV_HIT, IdOf(shooter), IdOf(target), target->type, IsMonster(target), 0);
}

void DG_OnUseLine(mobj_t *thing, line_t *line, int side)
{
    Event(EV_USE, IdOf(thing), line - lines, line->special, side, 0);
}

void DG_OnCrossLine(mobj_t *thing, int linenum, int side)
{
    Event(EV_CROSS, IdOf(thing), linenum, lines[linenum].special, side, 0);
}

void DG_OnSound(void *origin, int sfx_id)
{
    const byte *p = origin;

    if (origin == NULL)
        Event(EV_SOUND, sfx_id, 0, 0, 0, 0);
    else if (p >= (const byte *) sectors && p < (const byte *) (sectors + numsectors))
        // Doors, lifts and other sector sounds come from the sector's sound origin.
        Event(EV_SOUND, sfx_id, 2, (p - (const byte *) sectors) / sizeof(sector_t), 0, 0);
    else
        Event(EV_SOUND, sfx_id, 1, IdOf(origin), 0, 0);
}

int DG_TicsSuspended(void)
{
    return trial_state != TRIAL_RUNNING;
}

void DG_OnTicEnd(void)
{
    if (trial_state != TRIAL_RUNNING || gamestate != GS_LEVEL)
        return;

    // G_ExitLevel only queues the exit; the intermission it leads to never runs.
    if (gameaction == ga_completed && !pending_end)
    {
        Event(EV_EXIT, secretexit, 0, 0, 0, 0);
        pending_end = secretexit ? END_SECRET_EXIT : END_EXIT;
    }

    RecordTic();
    trial_tic++;

    if (!pending_end && tic_limit > 0 && trial_tic >= tic_limit)
        pending_end = END_TIMEOUT;

    if (pending_end)
        EndTrial(pending_end);
}

int DG_OnFrameStart(void)
{
    int32_t *r;

    frame_number++;
    if (trial_state == TRIAL_RUNNING)
    {
        r = Record(REC_FRAME, 2);
        if (r != NULL)
        {
            r[0] = frame_number;
            r[1] = trial_tic;
        }
    }
    return frame_number;
}

void DG_OnSpriteDrawn(vissprite_t *vis, int pixels)
{
    mobj_t *mo = vis->mobj;
    int32_t *r;

    if (trial_state != TRIAL_RUNNING || mo == NULL || pixels <= 0 || !IsMonster(mo))
        return;

    mo->dg_drawn_frame = frame_number;
    r = Record(REC_VISIBLE, VISIBLE_WORDS);
    if (r != NULL)
    {
        r[0] = mo->dg_id;
        r[1] = mo->type;
        r[2] = pixels;
        r[3] = mo->subsector->sector->lightlevel;
        r[4] = vis->colormap == NULL;  // spectre-style fuzz
        r[5] = mo->x;
        r[6] = mo->y;
    }
}

// Starts `map` (MAPxx) from scratch: skill 0-4, flags 1 = no monsters, 2 = fast, 4 = respawn.
// tics = time limit in game tics, 0 for none.
EMSCRIPTEN_KEEPALIVE void dg_start_trial(int map, int skill, int flags, int tics)
{
    int32_t *r;

    ReleaseDemo();
    stream_used = 0;
    stream_dropped = 0;
    next_mobj_id = 0;
    trial_tic = 0;
    tic_limit = tics;
    pending_end = 0;
    frame_number = 0;
    last_roi_tag = 0;
    last_sector = -1;

    nomonsters = (flags & 1) != 0;
    fastparm = (flags & 2) != 0;
    respawnparm = (flags & 4) != 0;

    // Same order as -record: allocate, load the level, then write the header.
    G_RecordDemo("trial");
    G_InitNew((skill_t) skill, 1, map);
    G_BeginRecording();
    trial_state = TRIAL_RUNNING;

    r = Record(REC_START, 1);
    if (r != NULL)
        r[0] = IdOf(players[consoleplayer].mo);
}

EMSCRIPTEN_KEEPALIVE void dg_abort_trial(void)
{
    if (trial_state == TRIAL_RUNNING)
        EndTrial(END_ABORTED);
}

EMSCRIPTEN_KEEPALIVE int32_t *dg_stream_data(void)
{
    return stream;
}

// Returns how many words were written since the last call; JS copies them right away.
EMSCRIPTEN_KEEPALIVE int dg_stream_take(void)
{
    int used = stream_used;

    stream_used = 0;
    return used;
}

EMSCRIPTEN_KEEPALIVE int dg_stream_dropped(void)
{
    return stream_dropped;
}

EMSCRIPTEN_KEEPALIVE byte *dg_demo_data(void)
{
    return demobuffer;
}

EMSCRIPTEN_KEEPALIVE int dg_demo_length(void)
{
    return demo_length;
}
