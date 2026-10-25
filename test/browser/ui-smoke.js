#!/usr/bin/env node
// Smoke test of index.html in a headless Chromium-based browser over CDP.
//   node test/browser/ui-smoke.js URL ZIP [--shot OUT.png] [--width PX] [--port 9333]
// Loads the card from ZIP through the real file input, powers on, skips the intro (key 7),
// continues (key 6) and checks that the announcements list shows the welcome sounds.
// Keys are pressed on the console with the pointer.
// With --join it continues: mode Normal (key 5 twice), then drags the blue ship from the
// drawer onto Grain and the green ship onto Rum and checks that the game announces two players.
// Finally it powers the console off and on again and checks that it boots once more.
// With --extras the card must bring emulator/board.png, console_overlay.png and board-antennas.json;
// with --card-settings also emulator/settings.json.
// With --language CODE the card must offer a Language choice; the test picks CODE before power on and
// checks that the announcements come from sounds/CODE/ (also after the power off → on cycle).
// With --settings FILE it loads FILE through Settings → Load…, checks the figures, console size and
// antenna ids on the page, then presses Save (download into FILE's folder) and compares the saved
// file with FILE. The browser must be able to write there.
// The browser must be able to read ZIP (for flatpak: flatpak run --filesystem=DIR:ro ...).
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [url, zip] = process.argv.slice(2);
const opt = n => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const port = opt('--port') ?? '9333';
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id) pending.get(m.id)?.(m);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? JSON.stringify(m.params.exceptionDetails));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(expr, ms = 30000) {
  for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); }
  return false;
}
/** Press console key k with the pointer. */
async function key(k, holdMs = 150) {
  const { x, y } = await ev(`(() => { const r = document.querySelector('.device .key[data-key="${k}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(holdMs);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
const sounds = () => ev("[...document.querySelectorAll('#sounds li')].map(l => l.textContent).reverse().join('\\n')");
let ok = true;
const check = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); ok &&= !!cond; };

await send('Runtime.enable'); await send('DOM.enable'); await send('Page.enable');
const width = Number(opt('--width') ?? 1000);
await send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 1400 : 900, deviceScaleFactor: 1, mobile: width < 600 });
await send('Page.navigate', { url });
await sleep(1500);
const doc = await send('DOM.getDocument');
const input = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#pick-zip' });
await send('DOM.setFileInputFiles', { nodeId: input.result.nodeId, files: [zip] });
check(await waitFor("document.getElementById('load-status').textContent.includes(' game files')", 60000),
  `card loaded: ${await ev("document.getElementById('load-status').textContent")}`);
const loadStatus = () => ev("document.getElementById('load-status').textContent");
const statusSays = text => waitFor(`document.getElementById('load-status').textContent.includes(${JSON.stringify(text)})`, 5000);
const extrasWanted = process.argv.includes('--extras');
const loaded = await loadStatus();
check(/^Loaded: \d+ game files(, \d+ emulator files?)?\. Ready!$/.test(loaded) && loaded.includes('emulator file') === extrasWanted,
  `status one line: ${loaded}`);
// the card's emulator/ folder: board picture, overlay, antenna layout (--extras: all three must come from the card)
for (const id of ['picture-status', 'overlay-status', 'antennas-status', 'settings-status']) {
  const text = await ev(`document.getElementById('${id}').textContent`);
  const must = id === 'settings-status' ? process.argv.includes('--card-settings') : process.argv.includes('--extras');
  if (must) check(text.includes('from the card') && !text.includes(';'), `${id}: ${text}`);
  else console.log(`     ${id}: ${text}`);
}
const settingsPath = opt('--settings');
if (settingsPath) {
  const want = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const pick = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#pick-settings' });
  await send('DOM.setFileInputFiles', { nodeId: pick.result.nodeId, files: [settingsPath] });
  check(await waitFor("document.getElementById('settings-status').textContent.includes('applied')"),
    `settings loaded: ${await ev("document.getElementById('settings-status').textContent")}`);
  const body = await ev('document.body.className');
  const figures = want.Figures?.['Show as']?.toLowerCase();
  if (figures) check(body.includes(`figures-${figures}`), `figures shown as ${figures} (body: ${body})`);
  const ids = want['Additional Overlays & Views']?.['Antenna Ids'];
  if (ids !== undefined) check(body.includes('show-antenna-ids') === ids, `antenna ids ${ids ? 'shown' : 'hidden'}`);
  const size = want.Console?.['Console size'];
  if (size !== undefined) check(Number(await ev("document.getElementById('console-size').value")) === size, `console size ${size}`);
  // Save: the download lands next to the file that was loaded
  const saved = join(dirname(settingsPath), 'settings.json');
  rmSync(saved, { force: true });
  const r = await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dirname(settingsPath) });
  if (r.error) await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dirname(settingsPath) });
  await ev("document.getElementById('settings-save').click(), 1");
  for (let t = 0; t < 40 && !existsSync(saved); t++) await sleep(250);
  if (!existsSync(saved)) check(false, `Save downloads ${saved}`);
  else {
    const got = JSON.parse(readFileSync(saved, 'utf8'));
    const same = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
    const diff = Object.entries(want).flatMap(([sec, entries]) => Object.entries(entries)
      .filter(([label, v]) => !same(got[sec]?.[label], v)).map(([label, v]) => `${sec} → ${label}: saved ${got[sec]?.[label]}, loaded ${v}`));
    check(diff.length === 0, `Save writes the loaded values back (${Object.keys(got).length} sections)${diff.length ? ': ' + diff.join('; ') : ''}`);
  }
}
// antenna editor: starts with the current layout, Clear All empties it, Cancel brings it back
const fields = () => ev("document.querySelectorAll('#board .board-field').length");
const before0 = await fields();
await ev("document.getElementById('antennas-edit').click(), 1");
check(before0 > 0 && await fields() === before0, `editor starts with the current layout (${before0} antennas)`);
await ev("document.getElementById('antennas-edit-clear').click(), 1");
check(await fields() === 0, 'Clear All empties the board');
await ev("document.getElementById('antennas-edit-cancel').click(), 1");
check(await fields() === before0 && await ev("document.getElementById('antennas-edit-clear').hidden"), 'Cancel restores the layout and hides Clear All');
// language: shown only for a game with two or more languages in its lang.txt
const language = opt('--language');
const languages = await ev("[...document.getElementById('language').options].map(o => o.value).join(',')");
if (language) {
  check(!await ev("document.getElementById('language-row').hidden") && languages.split(',').includes(language), `language choice offers ${language} (${languages})`);
  await ev(`(s => { s.value = ${JSON.stringify(language)}; s.dispatchEvent(new Event('change')); return 1; })(document.getElementById('language'))`);
} else console.log(`     language choice: ${await ev("document.getElementById('language-row').hidden") ? 'hidden' : 'shown'} (${languages || 'no lang.txt'})`);
const fromLanguage = () => (language ? ev(`[...document.querySelectorAll('#sounds li')].filter(l => /p\\d{4}\\.wav/.test(l.textContent)).every(l => l.title.includes('/${language}/'))`) : true);
await ev("document.getElementById('power').click(), 1");
check(await waitFor("[...document.querySelectorAll('#sounds li')].some(l => /intro\\.wav/.test(l.textContent))"), 'intro.wav plays');
check(await ev("document.getElementById('language').disabled"), 'language choice locked while powered on');
check(await waitFor("document.getElementById('load-status').textContent === 'Playing…'", 5000) && !await ev("document.getElementById('settings').hidden"), 'status: Playing… (no load info), settings stay open');
await ev("document.getElementById('pause').click(), 1");
check(await statusSays('Paused.'), 'status: Paused.');
await ev("document.getElementById('pause').click(), 1");
check(await statusSays('Playing…'), 'status: Playing… after resume');
await sleep(1500);
const lit = await ev("[...document.querySelectorAll('.device .key')].filter(b => b.querySelector('.tri i.on')).map(b => b.dataset.key).join(',')");
check(lit === '7', `key 7 LED lit during intro (lit: ${lit || 'none'})`);
await key(7);
check(await waitFor("[...document.querySelectorAll('#sounds li')].some(l => /p0231/.test(l.textContent))"), 'key 7 skips to welintro p0231');
if (language) check(await fromLanguage(), `announcements from sounds/${language}/`);
check(await waitFor("[...document.querySelectorAll('#sounds li')].some(l => /p0445/.test(l.textContent))", 45000), 'welintro reaches p0445');
await sleep(3000);
await key(6);
check(await waitFor("[...document.querySelectorAll('#sounds li')].some(l => /p0719/.test(l.textContent))"), 'key 6 -> choose_game_1 p0719');
const heard = re => waitFor(`[...document.querySelectorAll('#sounds li')].some(l => /${re}/.test(l.textContent))`, 60000);
async function center(selector) {
  return ev(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
}
async function drag(from, to) {
  await ev(`document.querySelector('${from}').scrollIntoView({ block: 'center' }), 1`);
  const a = await center(from), b = await center(to);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 8; i++)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
}
if (process.argv.includes('--join')) {
  await sleep(1500); await key(5);
  check(await heard('p0720'), 'key 5 -> choose_game_2 p0720');
  await sleep(1500); await key(5);
  check(await heard('p0809'), 'key 5 -> game mode Normal p0809');
  check(await heard('p0446'), 'game length announced');
  await sleep(2000); await key(6);
  check(await heard('p0002'), 'join prompt p0056/p0002');
  // the ships wait in the drawer; open it if it is closed
  await ev("document.getElementById('tray').hidden && document.getElementById('open-tray').click(), 1");
  await sleep(300);
  await drag('.ship[data-ship="1"]', '.field[data-antenna="17"]');
  check(await heard('p0289'), 'drag blue ship onto Grain -> player_bl p0289');
  await drag('.ship[data-ship="2"]', '.field[data-antenna="14"]');
  check(await heard('p0292'), 'drag green ship onto Rum -> player_gr p0292');
  await sleep(2500); await key(6);
  check(await heard('p0242'), 'key 6 -> players_2 p0242');
}
const intros = () => ev("[...document.querySelectorAll('#sounds li')].filter(l => /intro\\.wav/.test(l.textContent)).length");
const before = await intros();
await ev("document.getElementById('power').click(), 1");
check(await waitFor("document.getElementById('log').textContent.includes('powered off') && !document.getElementById('power').disabled"), 'power off hands the card back');
check(await waitFor("document.getElementById('load-status').textContent === 'Ready!'", 5000), `status after power off: ${await loadStatus()}`);
if (language) check(await ev(`!document.getElementById('language').disabled && document.getElementById('language').value === ${JSON.stringify(language)}`), `language still ${language} after power off`);
await ev("document.getElementById('power').click(), 1");
check(await waitFor(`[...document.querySelectorAll('#sounds li')].filter(l => /intro\\.wav/.test(l.textContent)).length > ${before}`), 'power on boots again (intro.wav)');
if (language) check(await fromLanguage(), `all announcements from sounds/${language}/`);
console.log('status:', await ev("document.querySelector('.stats').innerText.replace(/\\n/g, ' | ')"));
console.log('announcements:\n' + await sounds());
const shot = opt('--shot');
if (shot) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
  console.log(`screenshot: ${shot}`);
}
check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' / ') : ''}`);
ws.close();
process.exit(ok ? 0 : 1);
