// jspsych-fps-lab: paradigm modes, chosen per trial by dg_start_trial (see src/paradigms).
// Mode logic may depend only on map, skill, params, the trial seed and the ticcmds, and draws its
// randomness from its own PRNG, never P_Random/M_Random, so the demo of a trial replays exactly.

#include <stdint.h>

#include <emscripten.h>

#include "doomstat.h"
#include "i_system.h"
#include "m_misc.h"
#include "p_local.h"
#include "r_main.h"
#include "s_sound.h"

#include "dg_mode.h"

#define MAX_SPOTS 64

static int mode;
static int32_t params[DG_MODE_PARAMS];
static uint32_t prng_state;

// mulberry32 (Tommy Ettinger): small, fast, and easy to reproduce outside the engine.
static uint32_t Random(void)
{
    uint32_t t = prng_state += 0x6D2B79F5u;

    t = (t ^ (t >> 15)) * (t | 1u);
    t ^= t + (t ^ (t >> 7)) * (t | 61u);
    return t ^ (t >> 14);
}

// Uniform integer in [0, n).
static int RandomBelow(int n)
{
    return (int) (((uint64_t) Random() * (uint32_t) n) >> 32);
}

// Mode 1, threat corridor: threats appear one at a time at the map's teleport destinations
// (thing 14), each a seeded delay after the previous one died.
// params: 0 threats, 1-2 min/max delay in tics, 3 monster (index into threat_types),
// 4 attack (0 = the monster never wakes up), 5 teleport fog and sound.
static const mobjtype_t threat_types[] = { MT_POSSESSED, MT_SHOTGUY, MT_TROOP, MT_SERGEANT };

static mobj_t *spots[MAX_SPOTS];
static int num_spots;
static mobj_t *threat;
static int threats_spawned;
static int next_spawn_tic;

static int ThreatDelay(void)
{
    return params[1] + RandomBelow(params[2] - params[1] + 1);
}

static void ThreatStart(void)
{
    thinker_t *th;
    mobj_t *mo;

    if (params[0] < 1 || params[1] < 0 || params[2] < params[1]
        || params[3] < 0 || params[3] >= (int) arrlen(threat_types))
        I_Error("Threat corridor: invalid params");

    num_spots = 0;
    for (th = thinkercap.next; th != &thinkercap; th = th->next)
    {
        if (th->function.acp1 != (actionf_p1) P_MobjThinker)
            continue;
        mo = (mobj_t *) th;
        if (mo->type == MT_TELEPORTMAN && num_spots < MAX_SPOTS)
            spots[num_spots++] = mo;
    }
    if (num_spots == 0)
        I_Error("Threat corridor: the map has no teleport destinations (thing 14)");

    threat = NULL;
    threats_spawned = 0;
    next_spawn_tic = ThreatDelay();
}

static void ThreatTicker(void)
{
    mobj_t *spot, *player_mo, *fog;
    int index;

    // Checked every tic, so the pointer is dropped before a corpse could ever be removed.
    if (threat != NULL && threat->health <= 0)
    {
        threat = NULL;
        next_spawn_tic = leveltime + ThreatDelay();
    }
    if (threat != NULL || threats_spawned >= params[0] || leveltime < next_spawn_tic)
        return;

    index = RandomBelow(num_spots);
    spot = spots[index];
    player_mo = players[consoleplayer].mo;

    threat = P_SpawnMobj(spot->x, spot->y, ONFLOORZ, threat_types[params[3]]);
    threat->angle = R_PointToAngle2(threat->x, threat->y, player_mo->x, player_mo->y);
    threats_spawned++;
    DG_OnModeSpawn(threat, threats_spawned, index);

    if (params[4])
    {
        threat->target = player_mo;
        P_SetMobjState(threat, threat->info->seestate);
    }
    else
    {
        threat->dg_passive = true;
    }

    if (params[5])
    {
        fog = P_SpawnMobj(threat->x, threat->y, threat->z, MT_TFOG);
        S_StartSound(fog, sfx_telept);
    }
}

// Mode 2, two-door bandit: walking into the left door (sectors tagged 901) or the right one
// (902) is a choice. Its reward is drawn from that door's probability and shown (flash and chime,
// or a grunt); the player stays frozen for the feedback time, then is teleported back to the
// start (the map's teleport destination).
// params: 0 choices, 1 schedule (0 fixed, 1 drifting), 2-3 p_left/p_right (FRACUNIT = 1),
// 4 drift SD, 5-6 drift bounds, 7 feedback tics, 8 show score, 9-15 reversals: choice numbers
// after which fixed probabilities swap (0 = unused).
#define BANDIT_LEFT_TAG 901
#define BANDIT_RIGHT_TAG 902
#define BANDIT_REVERSALS 7
#define BONUSADD 6

static mobj_t *bandit_start;
static fixed_t bandit_p[2];
static int choices_made;
static int score;
static int return_tic;
static boolean bandit_done;
static char score_message[32];

// Irwin-Hall: the sum of 12 uniforms minus 6 is close to N(0, 1); exact in integers.
static fixed_t Gaussian(void)
{
    int64_t sum = 0;
    int i;

    for (i = 0; i < 12; i++)
        sum += RandomBelow(FRACUNIT);
    return (fixed_t) (sum - 6 * FRACUNIT);
}

// Random walk with reflecting bounds.
static void Drift(int door)
{
    fixed_t lo = params[5], hi = params[6];
    fixed_t p = bandit_p[door] + (fixed_t) (((int64_t) params[4] * Gaussian()) >> FRACBITS);

    while (lo < hi && (p < lo || p > hi))
        p = p > hi ? 2 * hi - p : 2 * lo - p;
    bandit_p[door] = lo < hi ? p : lo;
}

static void BanditStart(void)
{
    thinker_t *th;
    mobj_t *mo;
    int i;

    if (params[0] < 1 || params[1] < 0 || params[1] > 1 || params[7] < 0)
        I_Error("Bandit: invalid params");
    for (i = 2; i <= 6; i++)
    {
        if (params[i] < 0 || params[i] > FRACUNIT)
            I_Error("Bandit: invalid params");
    }
    if (params[1] == 1 && params[5] > params[6])
        I_Error("Bandit: invalid params");

    bandit_start = NULL;
    for (th = thinkercap.next; th != &thinkercap && bandit_start == NULL; th = th->next)
    {
        if (th->function.acp1 != (actionf_p1) P_MobjThinker)
            continue;
        mo = (mobj_t *) th;
        if (mo->type == MT_TELEPORTMAN)
            bandit_start = mo;
    }
    if (bandit_start == NULL)
        I_Error("Bandit: the map has no teleport destination (thing 14)");

    bandit_p[0] = params[2];
    bandit_p[1] = params[3];
    choices_made = 0;
    score = 0;
    return_tic = -1;
    bandit_done = false;
}

// As a teleporter line does it (EV_Teleport), but without the freeze after arriving and without
// the fog, which would hide the doors from the start for over a second; only its sound plays.
static void Teleport(mobj_t *mo, mobj_t *dest)
{
    P_TeleportMove(mo, dest->x, dest->y);
    mo->z = mo->floorz;
    mo->player->viewz = mo->z + mo->player->viewheight;
    S_StartSound(mo, sfx_telept);

    mo->angle = dest->angle;
    mo->momx = mo->momy = mo->momz = 0;
    mo->reactiontime = 0;
}

static void BanditTicker(void)
{
    player_t *player = &players[consoleplayer];
    mobj_t *mo = player->mo;
    int tag, door, reward, i;
    fixed_t swap;

    if (bandit_done)
        return;

    if (return_tic >= 0)
    {
        if (leveltime < return_tic)
            return;
        return_tic = -1;
        if (choices_made >= params[0])
        {
            bandit_done = true;
            return;
        }
        Teleport(mo, bandit_start);
        DG_OnModeReturn(choices_made + 1);
        return;
    }

    tag = mo->subsector->sector->tag;
    if (tag != BANDIT_LEFT_TAG && tag != BANDIT_RIGHT_TAG)
        return;

    door = tag == BANDIT_RIGHT_TAG;
    reward = RandomBelow(FRACUNIT) < bandit_p[door];
    choices_made++;
    score += reward;
    DG_OnModeChoice(choices_made, door, reward, bandit_p[0], bandit_p[1]);

    if (reward)
    {
        player->bonuscount += BONUSADD;
        S_StartSound(NULL, sfx_itemup);
    }
    else
    {
        S_StartSound(mo, sfx_noway);
    }
    if (params[8])
    {
        M_snprintf(score_message, sizeof(score_message), "Score: %d", score);
        player->message = score_message;
    }
    // P_PlayerThink neither moves nor turns the player while reactiontime runs down.
    mo->reactiontime = params[7];
    return_tic = leveltime + params[7];

    // Probabilities for the next choice.
    if (params[1] == 1)
    {
        Drift(0);
        Drift(1);
    }
    else
    {
        for (i = 0; i < BANDIT_REVERSALS; i++)
        {
            if (params[9 + i] == choices_made)
            {
                swap = bandit_p[0];
                bandit_p[0] = bandit_p[1];
                bandit_p[1] = swap;
            }
        }
    }
}

void DG_ModeStart(int new_mode, uint32_t seed)
{
    mode = new_mode;
    prng_state = seed;

    switch (mode)
    {
      case DG_MODE_CLASSIC:
        break;
      case DG_MODE_THREAT:
        ThreatStart();
        break;
      case DG_MODE_BANDIT:
        BanditStart();
        break;
      default:
        I_Error("Unknown mode %d", mode);
    }
}

void DG_ModeTicker(void)
{
    if (mode == DG_MODE_THREAT)
        ThreatTicker();
    else if (mode == DG_MODE_BANDIT)
        BanditTicker();
}

int DG_ModeDone(void)
{
    if (mode == DG_MODE_THREAT)
        return threat == NULL && threats_spawned >= params[0];
    return mode == DG_MODE_BANDIT && bandit_done;
}

// Params of the next trial; dg_start_trial doesn't reset them, so set all of them.
EMSCRIPTEN_KEEPALIVE void dg_set_param(int index, int value)
{
    if (index >= 0 && index < DG_MODE_PARAMS)
        params[index] = value;
}
