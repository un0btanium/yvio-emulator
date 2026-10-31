#!/usr/bin/env node
// Checks of the settings file (settings.js), no game card needed:
//   node test/settings.js           (--write regenerates examples/settings-default.json from ui/settings.js)
// - examples/settings-default.json has every entry with its default and reads back without errors
// - the controls in index.html match settings.js (labels, slider ranges and defaults, option texts)
// - a file with bad entries reports them and keeps the good ones
import { readFileSync, writeFileSync } from 'node:fs';
import { SETTINGS, defaultOf, parseSettings, settingsFile, settingsText } from '../ui/settings.js';

const root = new URL('..', import.meta.url).pathname;
if (process.argv.includes('--write')) {
  writeFileSync(root + 'examples/settings-default.json', settingsText(settingsFile(defaultOf)));
  console.log('wrote examples/settings-default.json');
}
let ok = true;
const check = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); ok &&= !!cond; };

// settings-default.json
const text = readFileSync(root + 'examples/settings-default.json', 'utf8');
check(text === settingsText(settingsFile(defaultOf)), 'settings-default.json matches settings.js (regenerate: node test/settings.js --write)');
const def = parseSettings(JSON.parse(text));
check(def.errors.length === 0, `settings-default.json reads without errors ${def.errors.join('; ')}`);
check(def.values.size === SETTINGS.length, `settings-default.json sets all ${SETTINGS.length} entries (${def.values.size})`);

// index.html controls
const html = readFileSync(root + 'index.html', 'utf8');
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const decode = s => s.replace(/&amp;/g, '&');
for (const s of SETTINGS) {
  if (s.key === 'overlay-rot') continue; // the "Rotate 90°" button, no control of its own
  const tag = html.match(new RegExp(`<(input|select)[^>]*id="${s.key}"[^>]*>`))?.[0];
  if (!tag) { check(false, `${s.key}: control in index.html`); continue; }
  const before = html.slice(0, html.indexOf(tag));
  const section = decode([...before.matchAll(/<h3>([^<]*)<\/h3>/g)].pop()?.[1] ?? '');
  // the label text sits right before the control ("Label <input…>") or right after it ("<input…> Label")
  const label = s.type === 'bool'
    ? html.slice(html.indexOf(tag) + tag.length).match(/^\s*([^<]+)/)?.[1].trim()
    : before.match(/>([^<>]*)$/)?.[1].trim();
  check(section === s.section && label === s.label, `${s.key}: "${section}" → "${label}" in index.html is "${s.section}" → "${s.label}"`);
  const a = attrs(tag);
  if (s.type === 'number') {
    check(Number(a.min) === s.min && Number(a.max) === s.max && Number(a.value) === s.default,
      `${s.key}: range ${a.min}..${a.max}, value ${a.value} in index.html match settings.js`);
  }
  if (s.type === 'choice') {
    const body = html.slice(html.indexOf(tag), html.indexOf('</select>', html.indexOf(tag)));
    const opts = Object.fromEntries([...body.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(m => [m[1], m[2]]));
    check(JSON.stringify(opts) === JSON.stringify(s.options), `${s.key}: options in index.html match settings.js`);
  }
}

// a file with mistakes: good entries apply, the rest is reported
const r = parseSettings({
  Game: { 'Figures Skin': 'ships' },
  Console: { 'Console size': 60, 'Audio volume': 50, Loudness: 3 },
  Sound: {},
  'Additional Overlays & Views': { 'Antenna Areas': 'Sometimes', 'Antenna Ids': true },
});
check(r.values.get('figures-skin') === 'ships' && r.values.get('volume') === 50 && r.values.get('view-antenna-ids') === true && r.values.size === 3,
  `good entries apply (${[...r.values].map(([k, v]) => `${k}=${v}`).join(', ')})`);
check(r.errors.length === 4 && r.errors.some(e => e.includes('Console size')) && r.errors.some(e => e.includes('Loudness'))
  && r.errors.some(e => e.includes('"Sound"')) && r.errors.some(e => e.includes('Antenna Areas')), `bad entries are reported: ${r.errors.join('; ')}`);
check(parseSettings([]).errors.length === 1, 'an array is not a settings file');

console.log(ok ? 'settings: all ok' : 'settings: FAILED');
process.exit(ok ? 0 : 1);
