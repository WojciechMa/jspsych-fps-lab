// Browser platform layer for doomgeneric: JS owns the clock, the input and the frame loop.

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#include "doomgeneric.h"
#include "doomstat.h"
#include "d_loop.h"
#include "i_video.h"
#include "m_controls.h"
#include "s_sound.h"

void D_Display(void);

EM_JS(double, js_engine_clock_ms, (void), {
    return Module.engineClockMs();
});

EM_JS(void, js_draw_frame, (const void *pixels, int width, int height), {
    Module.drawFrame(pixels, width, height);
});

#define KEY_QUEUE_SIZE 64

static uint16_t key_queue[KEY_QUEUE_SIZE];
static unsigned key_read = 0;
static unsigned key_write = 0;

static int mouse_buttons = 0;
static int mouse_dx = 0;
static int mouse_changed = 0;

void DG_Init(void)
{
    joybspeed = 29;  // >= MAX_JOY_BUTTONS means always run (see G_BuildTiccmd)
    dclick_use = 0;
}

void DG_DrawFrame(void)
{
    js_draw_frame(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

void DG_SleepMs(uint32_t ms)
{
    // The browser's main thread can't sleep; callers re-check the clock instead.
    (void) ms;
}

uint32_t DG_GetTicksMs(void)
{
    return (uint32_t) js_engine_clock_ms();
}

int DG_GetKey(int *pressed, unsigned char *key)
{
    uint16_t entry;

    if (key_read == key_write)
        return 0;

    entry = key_queue[key_read];
    key_read = (key_read + 1) % KEY_QUEUE_SIZE;
    *pressed = entry >> 8;
    *key = entry & 0xff;
    return 1;
}

int DG_GetMouse(int *buttons, int *dx)
{
    if (!mouse_changed)
        return 0;

    *buttons = mouse_buttons;
    *dx = mouse_dx;
    mouse_dx = 0;
    mouse_changed = 0;
    return 1;
}

void DG_SetWindowTitle(const char *title)
{
    (void) title;
}

EMSCRIPTEN_KEEPALIVE void dg_key(int pressed, int key)
{
    unsigned next = (key_write + 1) % KEY_QUEUE_SIZE;

    if (next == key_read)
        return;  // full: drop the new event rather than overwrite unread ones

    key_queue[key_write] = (uint16_t) (((pressed ? 1 : 0) << 8) | (key & 0xff));
    key_write = next;
}

EMSCRIPTEN_KEEPALIVE void dg_mouse_move(int dx)
{
    mouse_dx += dx;
    mouse_changed = 1;
}

EMSCRIPTEN_KEEPALIVE void dg_mouse_buttons(int buttons)
{
    mouse_buttons = buttons;
    mouse_changed = 1;
}

// Called once per browser frame: runs the tics that are due and redraws only if one ran.
EMSCRIPTEN_KEEPALIVE void dg_tick(void)
{
    int tic_before = gametic;

    I_StartFrame();
    TryRunTics();

    if (gametic == tic_before)
        return;

    S_UpdateSounds(players[consoleplayer].mo);

    if (screenvisible)
        D_Display();
}

int main(int argc, char **argv)
{
    // callMain's argv lives on the stack, but Doom keeps myargv for the whole session.
    char **args = malloc((argc + 1) * sizeof(char *));
    int i;

    for (i = 0; i < argc; i++)
        args[i] = strdup(argv[i]);
    args[argc] = NULL;

    doomgeneric_Create(argc, args);
    return 0;
}
