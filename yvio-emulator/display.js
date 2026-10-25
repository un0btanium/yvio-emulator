// Decoding of the 24-byte display buffer (os_display_get/set), from the game's own drawing code:
// - LED matrix pixel (x, y), 0 <= x, y < 12 (FUN_00029a30): row word fb[2y] << 8 | fb[2y+1], bit x.
// - Key LEDs (FUN_00029c2c): key k (0..11) has 3 colour channels c (0..2) at fb[2k] bit 4 + c.
//   Bit 7 of fb[2k] is unused.

export const SIZE = 12;

/** @returns {boolean} */
export function pixel(fb, x, y) {
  return ((((fb[2 * y] << 8) | fb[2 * y + 1]) >> x) & 1) === 1;
}

/** Colour channel bits (0..7) of key k's LED. */
export function keyLed(fb, k) {
  return (fb[2 * k] >> 4) & 7;
}

/** Text rendering for logs and tests: '#' = lit. Bit x = 0 is the rightmost column (text scrolls in there). */
export function toAscii(fb) {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    let s = '';
    for (let x = SIZE - 1; x >= 0; x--) s += pixel(fb, x, y) ? '#' : '.';
    rows.push(s);
  }
  const leds = [...Array(SIZE).keys()].map(k => keyLed(fb, k)).join('');
  return rows.join('\n') + `\nkey LEDs: ${leds}`;
}
