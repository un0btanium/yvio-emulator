// Page logic: the board fills the screen with the console in its middle; everything else is in
// the settings panel next to it. Loads the user's SD card files, starts and stops the emulator worker and
// the audio worklet, and forwards key presses and ship placements.

import { Vfs } from '../yvio-emulator/files.js';
import { createBoard } from './board-ui.js';
import { parseBoardLayout } from './board-layout.js';
import { createEditor } from './board-editor.js';
import { createConsole, store } from './console-ui.js';
import { SETTINGS, defaultOf, parseSettings, settingsFile, settingsText } from './settings.js';

const $ = id => document.getElementById(id);

/** @type {Worker|null} */
let worker = null;
const con = createConsole($('device'), {
  onKeys: mask => worker?.postMessage({ type: 'keys', mask }),
});

// ---- board -------------------------------------------------------------------------------
const board = createBoard($('board'), (ship, antenna) => worker?.postMessage({ type: 'place', ship, antenna }), $('tray-board'));
// The board picture is game artwork and is never shipped: emulator/board.png on the user's card
// copy (see useCardExtras), or a picture they choose; otherwise the drawn map stays.
$('pick-picture').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  board.setPicture(URL.createObjectURL(f));
  $('picture-status').textContent = `Using ${f.name}`;
});

// Where the antennas sit on the board: a file the user loads (remembered in the browser until
// Reset) or the card's emulator/board-antennas.json (useCardExtras), else
// examples/board-antennas-example.json. A file that is not valid keeps the current layout.
const DEFAULT_LAYOUT = 'board-antennas-example.json'; // in examples/, next to settings-default.json
function layoutError(name, message) {
  $('antennas-status').replaceChildren(Object.assign(document.createElement('span'), { className: 'bad', textContent: `${name}: ${message}` }));
}
/** the layout on the board: { json, name } */
let currentLayout = null;
/** @returns {boolean} whether the layout was used */
function useLayout(json, name) {
  try {
    const lay = parseBoardLayout(json);
    board.setLayout(lay);
    currentLayout = { json, name };
    $('antennas-status').textContent = `Using ${name} (${lay.spots.size} on the board, ${lay.unused.length} unused)`;
    return true;
  } catch (e) {
    layoutError(name, e.message);
    return false;
  }
}
async function useDefaultLayout() {
  let json;
  try {
    const r = await fetch(new URL(`../examples/${DEFAULT_LAYOUT}`, import.meta.url), { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } catch (e) {
    return layoutError(DEFAULT_LAYOUT, `could not be read (${e.message})`); // all antennas stay unused
  }
  useLayout(json, DEFAULT_LAYOUT);
}
const storedLayout = store.get('board-antennas');
if (!storedLayout || !useLayout(storedLayout.json, storedLayout.name)) useDefaultLayout();
$('pick-antennas').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = ''; // the same file can be loaded again after editing it
  if (!f) return;
  let json;
  try { json = JSON.parse(await f.text()); } catch (err) { return layoutError(f.name, `not valid JSON (${err.message})`); }
  if (useLayout(json, f.name)) store.set('board-antennas', { name: f.name, json });
});
$('antennas-reset').addEventListener('click', () => {
  store.set('board-antennas', null);
  useDefaultLayout();
});

// Antenna editor (board-editor.js): starts with the current layout (Clear All empties it); "Save
// Antennas" downloads the layout as board-antennas.json and uses it like a loaded file; Cancel
// restores the previous one.
const SAVED_LAYOUT = 'board-antennas.json';
let layoutBeforeEditor = null;
const editorStatus = n => {
  $('antennas-status').textContent = `Editor: ${n} antenna${n === 1 ? '' : 's'} placed. `
    + 'Click the board to add one (centre, then radius), or click an antenna to change it.';
};
const editor = createEditor(board, list => {
  board.setLayout(parseBoardLayout({ boardAntennas: list }));
  editorStatus(list.length);
});
function setEditing(on) {
  board.setEditing(on);
  document.body.classList.toggle('editing-antennas', on); // the console lets clicks through to the board
  $('antennas-edit').textContent = on ? 'Save Antennas' : 'Editor';
  $('antennas-edit-clear').hidden = !on;
  $('antennas-edit-cancel').hidden = !on;
  $('antennas-reset').disabled = on;
  $('pick-antennas').disabled = on;
  $('pick-antennas').parentElement.classList.toggle('disabled', on);
}
/** The layout file: one antenna per line, like examples/board-antennas-example.json. */
const layoutText = list => `{\n  "boardAntennas": [\n${list.map(e => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]\n}\n`;
function download(name, text) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('antennas-edit').addEventListener('click', () => {
  if (!editor.active) {
    layoutBeforeEditor = currentLayout;
    setEditing(true);
    const entries = currentLayout?.json.boardAntennas ?? [];
    editor.start(entries);
    editorStatus(entries.length);
    return;
  }
  const list = editor.stop();
  setEditing(false);
  const json = { boardAntennas: list };
  download(SAVED_LAYOUT, layoutText(list));
  if (useLayout(json, SAVED_LAYOUT)) store.set('board-antennas', { name: SAVED_LAYOUT, json });
});
$('antennas-edit-clear').addEventListener('click', () => editor.clear());
$('antennas-edit-cancel').addEventListener('click', () => {
  editor.stop();
  setEditing(false);
  if (layoutBeforeEditor) useLayout(layoutBeforeEditor.json, layoutBeforeEditor.name);
  else useDefaultLayout();
});

// ---- layout: settings, drawer, console size, enlarged console ------------------------------
// The settings (left of the board) and the drawer (right of it) share the screen with the board.
// On a wide screen both can be open; on a phone (portrait or narrow) only one at a time.
// The settings open on load; the drawer state is remembered (open on the first visit, because
// the ships wait there), like the open sections of the settings.
const ONE_PANEL = matchMedia('(orientation: portrait), (max-width: 900px)');
const trayWanted = () => store.get('tray-open') ?? true;
function setTray(open) {
  $('tray').hidden = !open;
  store.set('tray-open', open);
  if (open && ONE_PANEL.matches) $('settings').hidden = true;
}
function setSettings(open) {
  $('settings').hidden = !open;
  if (open && ONE_PANEL.matches) $('tray').hidden = true;
  // closing the settings brings the drawer back if it was open before
  else if (!open && trayWanted()) $('tray').hidden = false;
}
// turning a phone or narrowing the window: keep the settings, hide the drawer
ONE_PANEL.addEventListener('change', () => {
  if (ONE_PANEL.matches && !$('settings').hidden) $('tray').hidden = true;
  else if (!ONE_PANEL.matches && trayWanted()) $('tray').hidden = false;
});
$('tray').hidden = !trayWanted();
$('open-tray').addEventListener('click', () => setTray($('tray').hidden));
$('close-tray').addEventListener('click', () => setTray(false));
$('open-settings').addEventListener('click', () => setSettings($('settings').hidden));
$('close-settings').addEventListener('click', () => setSettings(false));
const sections = store.get('settings-sections') ?? {};
for (const d of $('settings').querySelectorAll('details[data-section]')) {
  if (d.dataset.section in sections) d.open = sections[d.dataset.section];
  d.addEventListener('toggle', () => { sections[d.dataset.section] = d.open; store.set('settings-sections', sections); });
}

// ---- view options: ids on the antennas and console keys, antenna areas, unused antennas ----
// Defaults are in settings.js: all but the areas (shown on interaction: hover, drag,
// tap-to-place) and the console's white shell are off; the figures are drawn as plain coloured circles, or as ships.
const VIEW_CHECKS = { 'view-antenna-ids': 'show-antenna-ids', 'view-key-ids': 'show-key-ids', 'console-shell': 'show-shell' };
// The OS keys (menu, volume −/+): hidden unless asked for, or while the
// console menu runs (it uses them).
let menuRunning = false;
function showOsKeys() { $('os-keys').hidden = !$('view-os-keys').checked && !menuRunning; }
$('view-os-keys').checked = store.get('view-os-keys') ?? defaultOf('view-os-keys');
showOsKeys();
$('view-os-keys').addEventListener('change', () => {
  showOsKeys();
  store.set('view-os-keys', $('view-os-keys').checked);
});
for (const [id, cls] of Object.entries(VIEW_CHECKS)) {
  const apply = () => { document.body.classList.toggle(cls, $(id).checked); store.set(id, $(id).checked); };
  $(id).checked = store.get(id) ?? defaultOf(id);
  $(id).addEventListener('change', apply);
  apply();
}
/** A select whose value becomes the body class `${prefix}-${value}`. */
function viewSelect(id, prefix) {
  const fallback = defaultOf(id);
  const sel = $(id);
  const apply = () => {
    for (const o of sel.options) document.body.classList.toggle(`${prefix}-${o.value}`, o.value === sel.value);
    store.set(id, sel.value);
  };
  sel.value = store.get(id) ?? fallback;
  if (!sel.value) sel.value = fallback; // a stored value that is no longer an option
  sel.addEventListener('change', apply);
  apply();
}
viewSelect('view-areas', 'areas');
viewSelect('figures-skin', 'figures'); // plain coloured circles or ship drawings
// Boot from the game, or from the console menu (the card's root app.elf), which then starts a
// game with os_exec as on the console. Applies at the next Power on. The menu chooses the game and
// its own and the games' menus the languages, so the Game and Language choices are hidden then.
$('boot-from').value = store.get('boot-from') ?? defaultOf('boot-from');
if (!$('boot-from').value) $('boot-from').value = defaultOf('boot-from');
$('boot-from').addEventListener('change', () => {
  store.set('boot-from', $('boot-from').value);
  if (vfs) showGames(vfs.games());
});
// Game Seed: the os_rand seed of a boot (the real OS takes a random 16-bit value from its PSoC).
// Not a settings-file entry and not stored: a new random one at every Power on, unless the player
// typed one in (kept until the field is cleared). os_exec reboots derive theirs from it (worker.js).
const SEED_MAX = 0xffff;
let seedTyped = false, seedFresh = true; // fresh: the random seed rolled at page load, not used yet
const randomSeed = () => crypto.getRandomValues(new Uint16Array(1))[0];
$('game-seed').value = String(randomSeed());
$('game-seed').addEventListener('input', () => { seedTyped = $('game-seed').value.trim() !== ''; });
/** The seed for this Power on (shown in the field). */
function bootSeed() {
  const v = Number($('game-seed').value);
  const fresh = seedFresh;
  seedFresh = false;
  if ((seedTyped || fresh) && Number.isInteger(v) && v >= 0 && v <= SEED_MAX) return v;
  seedTyped = false;
  const s = randomSeed();
  $('game-seed').value = String(s);
  return s;
}
/** Booting the console menu: chosen, and the card has one. */
const menuBoot = () => $('boot-from').value === 'menu' && !!vfs?.has('app.elf');
function setUnused() {
  board.showUnused($('view-unused').checked);
  store.set('view-unused', $('view-unused').checked);
}
$('view-unused').checked = store.get('view-unused') ?? defaultOf('view-unused');
$('view-unused').addEventListener('change', setUnused);
setUnused();

const CONSOLE_SIZE = defaultOf('console-size'); // % of the board width; about the real console on the real board
function setConsoleSize(v) {
  $('console-layer').style.setProperty('--console-size', `${v}%`);
  $('console-size').value = String(v);
  store.set('console-size', v);
}
setConsoleSize(store.get('console-size') ?? CONSOLE_SIZE);
$('console-size').addEventListener('input', e => setConsoleSize(Number(e.target.value)));

// A tap on the LED display enlarges the console (for small screens); a tap on the display or
// next to the console shrinks it again.
function setEnlarged(on) {
  $('console-layer').classList.toggle('enlarged', on);
  $('enlarge-backdrop').hidden = !on;
  con.draw();
}
$('leds').addEventListener('click', () => setEnlarged(!$('console-layer').classList.contains('enlarged')));
$('enlarge-backdrop').addEventListener('click', () => setEnlarged(false));

// ---- settings file: Save / Load, and emulator/settings.json on the card ---------------------
// Each setting is applied through its control, as if the user had changed it (so it is also
// remembered); the overlay ones go to the console. Entries a file leaves out stay as they are.
const OVERLAY_KEYS = new Set(SETTINGS.filter(s => s.section === 'Console Overlay').map(s => s.key));
/** @param {string} key  @returns {string|number|boolean} */
function currentSetting(key) {
  if (OVERLAY_KEYS.has(key)) return con.overlaySettings()[key];
  const el = $(key);
  return el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
}
/** @param {unknown} json  @param {string} source  shown in the status */
function applySettings(json, source) {
  const { values, errors } = parseSettings(json);
  const overlay = {};
  for (const [key, v] of values) {
    if (OVERLAY_KEYS.has(key)) { overlay[key] = v; continue; }
    const el = $(key);
    if (el.type === 'checkbox') el.checked = /** @type {boolean} */ (v); else el.value = String(v);
    el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change'));
  }
  con.setOverlaySettings(overlay);
  settingsStatus(`Settings from ${source}: ${values.size} applied.`, errors);
}
function settingsStatus(text, errors = []) {
  const bad = errors.length ? [Object.assign(document.createElement('span'), { className: 'bad', textContent: ` ${errors.join('; ')}` })] : [];
  $('settings-status').replaceChildren(text, ...bad);
}
$('settings-save').addEventListener('click', () => download('settings.json', settingsText(settingsFile(currentSetting))));
$('pick-settings').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = ''; // the same file can be loaded again
  if (!f) return;
  try { applySettings(JSON.parse(await f.text()), f.name); } catch (err) { settingsStatus('', [`${f.name}: not valid JSON (${err.message})`]); }
});

// ---- screen: fullscreen, wake lock -------------------------------------------------------
if (document.documentElement.requestFullscreen) {
  $('fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(e => log(`fullscreen refused: ${e.message}`));
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').textContent = document.fullscreenElement ? 'Leave fullscreen' : 'Fullscreen';
  });
} else $('fullscreen').hidden = true;

let wakeLock = null;
async function updateWakeLock() {
  const want = $('wake-lock').checked && worker !== null && document.visibilityState === 'visible';
  if (want && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { log(`wake lock refused: ${e.message}`); }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
if ('wakeLock' in navigator) {
  $('wake-lock').checked = store.get('wake-lock') ?? defaultOf('wake-lock');
  $('wake-lock').addEventListener('change', () => { store.set('wake-lock', $('wake-lock').checked); updateWakeLock(); });
  // the browser drops the lock when the page is hidden; take it again when it comes back
  document.addEventListener('visibilitychange', updateWakeLock);
} else $('wake-lock-row').hidden = true;

// ---- loading the SD card -----------------------------------------------------------------
/** @type {Vfs|null} */
let vfs = null;
/** sound file name (lower case, e.g. "p0719.wav") -> aliases from files_LANG.txt */
const aliases = new Map();
/** what the last card load brought ("Loaded: N game files, M emulator files."), until power on */
let loadInfo = '';

/** The card status in one line: what was just loaded, then whether it is ready, playing or paused. */
function showLoadStatus() {
  const state = worker ? (paused ? 'Paused.' : 'Playing…') : vfs ? 'Ready!' : '';
  const info = Object.assign(document.createElement('span'), { className: 'ok', textContent: loadInfo });
  $('load-status').replaceChildren(...(loadInfo ? [info, ' '] : []), state);
}

async function useVfs(promise) {
  $('load-status').textContent = 'Reading files…';
  $('power').disabled = true;
  try {
    const next = await promise;
    const games = next.games();
    if (!games.length) {
      $('load-status').innerHTML = '<span class="bad">Not a Yvio SD card: no game folder with an app.elf found.</span>';
      return;
    }
    const extras = next.take(CARD_EXTRAS);
    vfs = next;
    showGames(games);
    const used = useCardExtras(extras);
    loadInfo = `Loaded: ${vfs.files.size} game files${used ? `, ${used} emulator file${used === 1 ? '' : 's'}` : ''}.`;
    showLoadStatus();
  } catch (e) {
    $('load-status').innerHTML = `<span class="bad">${e.message}</span>`;
  } finally {
    $('power').disabled = !vfs && !worker;
  }
}

// The game folder on the card (e.g. "pirates"): the root folders other than the console's own
// (Vfs.games()). With more than one the Console section shows a choice, remembered in the browser;
// it applies at the next Power on.
let game = null;
/** @param {string[]} games */
function showGames(games) {
  const sel = /** @type {HTMLSelectElement} */ ($('game'));
  sel.replaceChildren(...games.map(g => new Option(g, g)));
  const last = store.get('game');
  sel.value = games.includes(last) ? last : games[0];
  $('game-row').hidden = games.length < 2 || menuBoot();
  useGame(sel.value);
}
function useGame(name) {
  game = name;
  showLanguages(store.get('language'));
}
$('game').addEventListener('change', e => {
  store.set('game', e.target.value);
  useGame(e.target.value);
});

// The game's languages (GAME/lang.txt, e.g. "de" and "en" on Freibeuter der Karibik 1.1). With
// more than one the Console section shows a choice, remembered in the browser; it is written into
// the card's lang.txt (as the game's own menu does) and applies at the next Power on. When booting
// the console menu the card's own choice stays.
/** @param {string} [want]  the language code to select if the game has it, else the card's own choice */
function showLanguages(want) {
  const langs = vfs?.languages(game);
  const sel = /** @type {HTMLSelectElement} */ ($('language'));
  sel.replaceChildren(...(langs?.languages ?? []).map(l => new Option(`${l.name} (${l.code})`, l.code)));
  $('language-row').hidden = (langs?.languages.length ?? 0) < 2 || menuBoot();
  if (!langs) return useLanguage('de');
  const codes = langs.languages.map(l => l.code);
  sel.value = codes.includes(want) && !menuBoot() ? want : codes[langs.selected];
  useLanguage(sel.value);
}
function useLanguage(code) {
  vfs?.setLanguage(game, code);
  readAliases(aliasFile(game, code));
}
/** GAME/files_CODE.txt (the sound aliases), CODE = the card's choice in GAME/lang.txt by default. */
function aliasFile(name, code = cardLanguage(name)) {
  return vfs?.get(`${name}/files_${code}.txt`) ?? new Uint8Array();
}
function cardLanguage(name) {
  const langs = vfs?.languages(name);
  return langs ? langs.languages[langs.selected].code : 'de';
}
$('language').addEventListener('change', e => {
  store.set('language', e.target.value);
  useLanguage(e.target.value);
});

// The page's own extras can sit on the card copy in an emulator/ folder (all optional): the board
// picture, the console overlay picture and the antenna layout (the file name Save Antennas
// downloads), and settings.json. They are used on every card load; pictures or a layout loaded
// by hand replace them until the next card. The layout is not remembered: the card brings it
// again. The settings are applied last, so that the overlay values reach the card's overlay.
const CARD_EXTRAS = 'emulator';
const PICTURE = /^(board|console_overlay)\.(png|jpe?g|webp)$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
/** blob URL per picture kind ("board", "console_overlay"), revoked when a new card replaces it */
const cardPictures = new Map();

/**
 * @param {{path:string, data:Uint8Array}[]} files  the card's emulator/ folder
 * @returns {number} how many of them were used (pictures, layout, settings; others are ignored)
 */
function useCardExtras(files) {
  let settings = null, used = 0;
  for (const { path, data } of files) {
    if (/^settings\.json$/i.test(path)) { settings = { path, data }; continue; }
    const m = PICTURE.exec(path);
    if (m) {
      used++;
      const kind = m[1].toLowerCase();
      const url = URL.createObjectURL(new Blob([data], { type: MIME[m[2].toLowerCase()] }));
      if (cardPictures.has(kind)) URL.revokeObjectURL(cardPictures.get(kind));
      cardPictures.set(kind, url);
      const from = `${path} from the card`;
      if (kind === 'board') {
        board.setPicture(url);
        $('picture-status').textContent = `Using ${from}`;
      } else con.setCardOverlay(url, from);
    } else if (/^board-antennas\.json$/i.test(path)) {
      const name = `${path} from the card`;
      let json;
      try { json = JSON.parse(new TextDecoder().decode(data)); } catch (e) { layoutError(name, `not valid JSON (${e.message})`); continue; }
      if (!editor.active) { if (useLayout(json, name)) used++; }
      else {
        // keep the board being edited; Cancel goes back to the card's layout instead
        try { parseBoardLayout(json); layoutBeforeEditor = { json, name }; used++; } catch (e) { layoutError(name, e.message); }
      }
    }
  }
  if (settings) {
    const name = `${settings.path} from the card`;
    try { applySettings(JSON.parse(new TextDecoder().decode(settings.data)), name); used++; } catch (e) { settingsStatus('', [`${name}: not valid JSON (${e.message})`]); }
  }
  return used;
}

function readAliases(bytes) {
  aliases.clear();
  const text = new TextDecoder('latin1').decode(bytes);
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^#=\s][^=]*)=(.*)$/.exec(line);
    if (!m) continue;
    for (const f of m[2].matchAll(/\?\?([\w]+\.wav)/gi)) {
      const key = f[1].toLowerCase();
      if (!aliases.has(key)) aliases.set(key, []);
      const list = aliases.get(key);
      if (list.length < 3 && !list.includes(m[1])) list.push(m[1]);
    }
  }
}

$('pick-dir').addEventListener('change', e => useVfs(Vfs.fromFileList(e.target.files)));
$('pick-zip').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) useVfs(f.arrayBuffer().then(b => Vfs.fromZip(new Uint8Array(b))));
});

const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('over');
  const items = [...e.dataTransfer.items];
  const file = e.dataTransfer.files[0];
  if (file && /\.zip$/i.test(file.name)) return useVfs(file.arrayBuffer().then(b => Vfs.fromZip(new Uint8Array(b))));
  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  useVfs(readEntries(entries));
});

/** Read dropped directory entries recursively into a Vfs. */
async function readEntries(entries) {
  const vfs = new Vfs();
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      vfs.add(prefix + entry.name, new Uint8Array(await file.arrayBuffer()));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  vfs.rerootAtCard();
  return vfs;
}

// ---- power on / off ----------------------------------------------------------------------
let audioCtx = null, audioNode = null, audioStats = 0;
let paused = false;
/** Power off waits this long for the worker to hand the card back, then stops it anyway. */
const SHUTDOWN_TIMEOUT_MS = 3000;
let shutdownTimer = 0;

$('power').addEventListener('click', () => (worker ? powerOff() : powerOn()));

async function powerOn() {
  if (!vfs) return;
  $('power').disabled = true;
  // Audio must be created in the click handler (autoplay rules).
  let audioPort = null;
  try {
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
    await audioCtx.audioWorklet.addModule(new URL('../yvio-emulator/audio-worklet.js', import.meta.url));
    audioNode = new AudioWorkletNode(audioCtx, 'yvio-audio', { outputChannelCount: [2] });
    audioNode.connect(audioCtx.destination);
    const ch = new MessageChannel();
    audioNode.port.postMessage({ type: 'source', port: ch.port1 }, [ch.port1]);
    audioPort = ch.port2;
    audioNode.port.onmessage = ({ data }) => {
      if (data.type === 'stats') $('st-audio').textContent =
        `${(data.queued / 22.05).toFixed(0)} ms buffered, ${data.underruns} gaps, output ${audioCtx.sampleRate} Hz`;
    };
    audioStats = setInterval(() => audioNode?.port.postMessage({ type: 'stats' }), 1000);
    setVolume();
    // Don't wait: without a real user gesture resume() can stay pending forever.
    audioCtx.resume().catch(e => log(`audio resume failed: ${e.message}`));
  } catch (e) {
    log(`audio unavailable: ${e.message}`);
  }

  worker = new Worker(new URL('../yvio-emulator/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = e => log(`worker error: ${e.message}`);
  let appPath = `${game}/app.elf`;
  if (menuBoot()) appPath = 'app.elf';
  else if ($('boot-from').value === 'menu') log('no console menu (app.elf) on the card: starting the game');
  // the sound aliases of every game, for the one the console menu starts (copies: tiny files)
  menuAliases = new Map(vfs.games().map(g => [g.toLowerCase(), aliasFile(g).slice()]));
  const files = [], transfer = [];
  for (const f of vfs.files.values()) {
    const data = f.data.byteOffset === 0 && f.data.byteLength === f.data.buffer.byteLength ? f.data : f.data.slice();
    files.push([f.path, data.buffer]);
    transfer.push(data.buffer);
  }
  if (audioPort) transfer.push(audioPort);
  worker.postMessage({ type: 'boot', files, appPath, audioPort, placements: board.placements(),
    volume: toConsoleVolume(Number($('volume').value)), seed: bootSeed() }, transfer);
  vfs = null; // the buffers now belong to the worker; power off hands them back

  paused = false;
  $('pause').textContent = 'Pause';
  $('pause').disabled = false;
  $('power').textContent = 'Power off';
  $('power').disabled = false;
  $('game').disabled = $('language').disabled = true; // the choices apply at the next Power on
  loadInfo = ''; // from now on only the state
  showLoadStatus();
  updateWakeLock();
}

/** Stop the emulator. The worker sends the card files back, so it can be powered on again. */
function powerOff() {
  if (!worker) return;
  $('power').disabled = true;
  $('pause').disabled = true;
  worker.postMessage({ type: 'shutdown' });
  shutdownTimer = setTimeout(() => {
    // e.g. a cached old worker.js that doesn't know 'shutdown': the card files are lost with it
    log('the emulator did not answer power off; stopped it');
    onShutdown(null);
  }, SHUTDOWN_TIMEOUT_MS);
}

/** @param {[string, ArrayBuffer][] | null} files  the card handed back, or null if it is lost */
function onShutdown(files) {
  clearTimeout(shutdownTimer);
  worker.terminate();
  worker = null;
  if (files) {
    vfs = new Vfs();
    for (const [path, buf] of files) vfs.add(path, new Uint8Array(buf));
    // the game's own menu may have changed the language: follow the card
    const langs = vfs.languages(game);
    if (langs && langs.languages.length > 1) store.set('language', langs.languages[langs.selected].code);
    showGames(vfs.games()); // the console menu may have started another game
    showLoadStatus();
  } else {
    $('load-status').innerHTML = '<span class="bad">Load the card again to power on.</span>';
  }
  clearInterval(audioStats);
  audioCtx?.close().catch(() => {});
  audioCtx = audioNode = null;
  con.releaseAll();
  con.show(new Uint8Array(24));
  followApp('');
  $('st-app').textContent = 'off';
  $('st-speed').textContent = '–';
  $('st-audio').textContent = '–';
  $('power').textContent = 'Power on';
  $('power').disabled = !vfs;
  $('game').disabled = $('language').disabled = false;
  updateWakeLock();
  log('powered off');
}

// The Audio volume slider (0–100 %) is the console volume (0–255, OS keys 13/14 change it by 4):
// both follow each other, the output gain is linear in the slider.
const toConsoleVolume = pct => Math.round(pct * 255 / 100);
function setVolume() {
  audioNode?.port.postMessage({ type: 'volume', value: Number($('volume').value) / 100 });
  store.set('volume', Number($('volume').value));
}
$('volume').value = String(store.get('volume') ?? defaultOf('volume'));
$('volume').addEventListener('input', () => {
  setVolume();
  worker?.postMessage({ type: 'volume', value: toConsoleVolume(Number($('volume').value)) });
});

$('pause').addEventListener('click', async () => {
  if (!worker) return;
  paused = !paused;
  worker.postMessage({ type: paused ? 'pause' : 'resume' });
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  showLoadStatus();
  if (paused) await audioCtx?.suspend(); else await audioCtx?.resume();
});

/**
 * Track the running app: the OS keys show while the console menu runs, and a game the menu
 * started (e.g. "PIRATES/app.elf") becomes the selected game.
 * @param {string} app  the app path from the worker, '' when off
 */
function followApp(app) {
  const menu = app.toLowerCase() === 'app.elf';
  if (menu === menuRunning) return;
  menuRunning = menu;
  showOsKeys();
  if (menu || !app) return;
  log(`the console menu started ${app}`);
  const folder = app.split('/').slice(0, -1).join('/').toLowerCase();
  readAliases(menuAliases.get(folder) ?? new Uint8Array());
  const pick = [...$('game').options].find(o => o.value.toLowerCase() === folder);
  if (pick && pick.value !== game) {
    $('game').value = game = pick.value;
    store.set('game', game);
  }
}
/** @type {Map<string, Uint8Array>} lower-case game folder -> its files_CODE.txt, kept at Power on */
let menuAliases = new Map();

// ---- worker messages ---------------------------------------------------------------------
function onWorkerMessage({ data }) {
  switch (data.type) {
    case 'display':
      con.show(data.fb);
      break;
    case 'file':
      if (data.ok && /\.wav$/i.test(data.path)) addSound(data.path, data.t);
      else if (!data.ok) log(`fopen failed: ${data.path}`);
      break;
    case 'status':
      followApp(data.app);
      $('st-app').textContent = data.app + (data.halted ? ` — halted: ${data.halted}` : '');
      $('st-time').textContent = formatTime(data.virtualMs);
      $('st-speed').textContent = data.speed ? `${(data.speed * 100).toFixed(0)} % of real time` : '–';
      break;
    case 'volume': // the app changed the console volume (keys 13/14, or its default 200 at boot)
      $('volume').value = String(Math.round(data.value * 100 / 255));
      setVolume();
      break;
    case 'log':
      log(data.text);
      break;
    case 'files':
      if (worker) onShutdown(data.files);
      break;
  }
}

function addSound(path, t) {
  const name = path.split('/').pop();
  const li = document.createElement('li');
  const al = aliases.get(name.toLowerCase());
  li.title = path;
  li.innerHTML = `${formatTime(t)} ${name}${al ? ` <span class="alias">${al.join(', ')}</span>` : ''}`;
  const list = $('sounds');
  list.prepend(li);
  while (list.children.length > 60) list.lastChild.remove();
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function log(text) {
  const pre = $('log');
  pre.textContent = (pre.textContent + text + '\n').slice(-20000);
}

// on load (until M5 keeps the card): start in the settings
setSettings(true);
