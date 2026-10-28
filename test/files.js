#!/usr/bin/env node
// Checks of the virtual SD card (yvio-emulator/files.js), no game card needed:
//   node test/files.js
// - rerootAtCard() finds the card root (the folder with system/) below extra folders
// - games() lists the game folders: root folders with an app.elf, not the console's own
// - readLanguages()/setLanguage() read and select the languages of a game's lang.txt
// - add() keeps the name of a file it replaces (any case, as on FAT)
import { Vfs, readLanguages, withLanguage } from '../yvio-emulator/files.js';

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

// the game started by the console menu writes "PIRATES/lang.txt": the file keeps its name
v = card([...CONSOLE, 'pirates/app.elf', 'pirates/lang.txt']);
v.add('PIRATES/LANG.TXT', new Uint8Array(2));
check(v.files.get('pirates/lang.txt').path === 'pirates/lang.txt' && v.get('pirates/lang.txt').length === 2, 'replacing a file keeps its name\'s case');

v = card(['sdcard/pirates/app.elf', 'sdcard/pirates/files_de.txt']);
check(same(v.games(), ['pirates']), 'no system/ folder: the common folder is stripped');

// lang.txt: count, selected, then (length, name, 2-letter code) per language
const lang = (count, selected, ...entries) => new Uint8Array([count, selected,
  ...entries.flatMap(([name, code]) => [name.length, ...[...name + code].map(c => c.charCodeAt(0))])]);
const two = lang(2, 0, ['deutsch', 'de'], ['english', 'en']);
let l = readLanguages(two);
check(l && l.selected === 0 && same(l.languages, [{ name: 'deutsch', code: 'de' }, { name: 'english', code: 'en' }]), 'lang.txt: two languages');
check(readLanguages(withLanguage(two, 1))?.selected === 1 && two[1] === 0, 'withLanguage: selects a copy');
check(readLanguages(null) === null && readLanguages(new Uint8Array([0, 0])) === null, 'lang.txt missing or empty: null');
l = readLanguages(two.subarray(0, two.length - 1));
check(same(l?.languages.map(x => x.code), ['de']), 'lang.txt cut short: the whole entries');
check(readLanguages(lang(2, 5, ['deutsch', 'de'], ['english', 'en']))?.selected === 0, 'lang.txt: selected out of range -> 0');

v = card([...CONSOLE, 'pirates/app.elf']);
v.add('Pirates/Lang.txt', two);
check(v.setLanguage('pirates', 'EN') && v.languages('pirates').selected === 1 && v.has('Pirates/Lang.txt')
  && [...v.files.values()].some(f => f.path === 'Pirates/Lang.txt'), 'setLanguage: writes byte 1, keeps the path');
check(!v.setLanguage('pirates', 'fr') && v.languages('pirates').selected === 1, 'setLanguage: unknown code is refused');
check(!card([...CONSOLE, 'pirates/app.elf']).setLanguage('pirates', 'de'), 'setLanguage: no lang.txt');

console.log(ok ? 'files: all ok' : 'files: FAILED');
process.exit(ok ? 0 : 1);
