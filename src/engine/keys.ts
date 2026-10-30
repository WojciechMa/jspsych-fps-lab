// Game controls: KeyboardEvent.code → Doom key code (engine/doomgeneric/doomkeys.h).
const KEY_UP = 0xad;
const KEY_DOWN = 0xaf;
const KEY_STRAFE_LEFT = 0xa0;
const KEY_STRAFE_RIGHT = 0xa1;
const KEY_USE = 0xa2;

export const KEY_BINDINGS: Readonly<Record<string, number>> = {
  KeyW: KEY_UP,
  KeyS: KEY_DOWN,
  KeyA: KEY_STRAFE_LEFT,
  KeyD: KEY_STRAFE_RIGHT,
  KeyE: KEY_USE,
  Digit1: 0x31,
  Digit2: 0x32,
  Digit3: 0x33,
  Digit4: 0x34,
  Digit5: 0x35,
  Digit6: 0x36,
  Digit7: 0x37,
};
