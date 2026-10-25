// The antenna layout of the board: which antennas sit where on the board picture, read from a
// JSON file (examples/board-antennas-example.json by default, emulator/board-antennas.json on the card, or
// one the user loads):
//   { "boardAntennas": [ { "antennaId": 18, "boardCoords": { "x": 245, "y": 190 },
//                          "fallbackName": "Port", "radius": 70 }, ... ] }
// Coordinates are pixels of the 1024 × 1024 board picture (origin top left). fallbackName (shown
// only without a board picture) and radius (of the area for hovering and dropping) are optional.
// Antennas that are not listed are "unused": they wait in the drawer.

import { ANTENNAS } from '../yvio-emulator/board.js';

export const DEFAULT_RADIUS = 60;

/** @typedef {{ spots: Map<number, {x:number, y:number, r:number, name:string}>, unused: number[] }} BoardLayout */

/**
 * Check a parsed JSON file and turn it into the lookup the board uses.
 * @param {unknown} json
 * @returns {BoardLayout}
 * @throws {Error} with a message for the user if the file is not a valid layout
 */
export function parseBoardLayout(json) {
  const list = /** @type {any} */ (json)?.boardAntennas;
  if (!Array.isArray(list)) throw new Error('expected an object with a "boardAntennas" array');
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const spots = new Map();
  list.forEach((e, i) => {
    const where = `boardAntennas[${i}]`;
    const a = e?.antennaId;
    if (!Number.isInteger(a) || a < 0 || a >= ANTENNAS) throw new Error(`${where}: "antennaId" must be a whole number 0–${ANTENNAS - 1}`);
    if (spots.has(a)) throw new Error(`${where}: antenna ${a} is listed twice`);
    const { x, y } = e.boardCoords ?? {};
    if (!num(x) || !num(y)) throw new Error(`${where}: "boardCoords" needs numbers "x" and "y"`);
    const r = e.radius ?? DEFAULT_RADIUS;
    if (!num(r) || r <= 0) throw new Error(`${where}: "radius" must be a positive number`);
    const name = e.fallbackName ?? '';
    if (typeof name !== 'string') throw new Error(`${where}: "fallbackName" must be a string`);
    spots.set(a, { x, y, r, name });
  });
  const unused = [];
  for (let a = 0; a < ANTENNAS; a++) if (!spots.has(a)) unused.push(a);
  return { spots, unused };
}
