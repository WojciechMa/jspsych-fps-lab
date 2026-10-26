// Web Audio sound effects: passes each sound's lump (DMX format) to JS, which decodes and
// mixes it. No music: the music module stays unset.

#include <emscripten.h>

#include "deh_str.h"
#include "i_sound.h"
#include "m_misc.h"
#include "w_wad.h"
#include "z_zone.h"

EM_JS(void, js_start_sound, (int channel, int lump, const void *data, int length, int vol, int sep), {
    Module.startSound(channel, lump, data, length, vol, sep);
});

EM_JS(void, js_update_sound, (int channel, int vol, int sep), {
    Module.updateSound(channel, vol, sep);
});

EM_JS(void, js_stop_sound, (int channel), {
    Module.stopSound(channel);
});

EM_JS(int, js_sound_playing, (int channel), {
    return Module.soundPlaying(channel) ? 1 : 0;
});

static snddevice_t sound_devices[] = { SNDDEVICE_SB };
static boolean use_prefix;

static boolean Init(boolean use_sfx_prefix)
{
    use_prefix = use_sfx_prefix;
    return true;
}

static void Shutdown(void)
{
}

static int GetSfxLumpNum(sfxinfo_t *sfx)
{
    char name[9];

    if (sfx->link != NULL)
        sfx = sfx->link;

    if (use_prefix)
        M_snprintf(name, sizeof(name), "ds%s", DEH_String(sfx->name));
    else
        M_StringCopy(name, DEH_String(sfx->name), sizeof(name));

    return W_CheckNumForName(name);
}

static void Update(void)
{
}

static void UpdateSoundParams(int channel, int vol, int sep)
{
    js_update_sound(channel, vol, sep);
}

static int StartSound(sfxinfo_t *sfx, int channel, int vol, int sep)
{
    int lump = sfx->lumpnum;

    if (lump < 0)
        return -1;

    js_start_sound(channel, lump, W_CacheLumpNum(lump, PU_CACHE), W_LumpLength(lump), vol, sep);
    return channel;
}

static void StopSound(int channel)
{
    js_stop_sound(channel);
}

static boolean SoundIsPlaying(int channel)
{
    return js_sound_playing(channel);
}

sound_module_t DG_web_sound_module =
{
    sound_devices,
    arrlen(sound_devices),
    Init,
    Shutdown,
    GetSfxLumpNum,
    Update,
    UpdateSoundParams,
    StartSound,
    StopSound,
    SoundIsPlaying,
    NULL,
};
