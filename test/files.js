#!/usr/bin/env node
// Checks of the virtual SD card (yvio-emulator/files.js), no game card needed:
//   node test/files.js
// - rerootAtCard() finds the card root (the folder with system/) below extra folders
// - games() lists the game folders: root folders with an app.elf, not the console's own
import { Vfs } from '../yvio-emulator/files.js';

let ok = true;
const check = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); ok &&= !!cond; };
const card = paths => {
  const vfs = new Vfs();
  for (const p of paths) vfs.add(p, new Uint8Array(1));
  vfs.rerootAtCard();
  return vfs;
};
const CONSOLE = ['app.elf', 'system/key_down.wav', 'menu/de_menu.txt', 'osup/OS.elf', 'emulator/board.png'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let v = card([...CONSOLE, 'pirates/app.elf', 'pirates/files_de.txt']);
check(same(v.games(), ['pirates']) && v.has('pirates/app.elf'), 'card at the root: one game');

v = card([...CONSOLE, 'pirates/app.elf'].map(p => `freibeuter/${p}`));
check(same(v.games(), ['pirates']) && v.has('app.elf') && v.has('system/key_down.wav'), 'card in a picked folder: rerooted');

v = card([...CONSOLE, 'pirates/app.elf'].map(p => `backup/sdcard/${p}`));
check(same(v.games(), ['pirates']) && v.has('pirates/app.elf'), 'card two folders deep: rerooted');

v = card([...CONSOLE, 'Pirates/APP.ELF', 'other/app.elf']);
check(same(v.games(), ['other', 'Pirates']), `two games, sorted, any case (${v.games()})`);

v = card([...CONSOLE, 'pirates/app.elf', 'notes/readme.txt', 'System Volume Information/IndexerVolumeGuid']);
check(same(v.games(), ['pirates']), 'folders without app.elf are no games');

v = card(CONSOLE);
check(v.games().length === 0, 'no game folder: none');

v = card(['sdcard/pirates/app.elf', 'sdcard/pirates/files_de.txt']);
check(same(v.games(), ['pirates']), 'no system/ folder: the common folder is stripped');

console.log(ok ? 'files: all ok' : 'files: FAILED');
process.exit(ok ? 0 : 1);
