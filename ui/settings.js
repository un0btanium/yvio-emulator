// The settings of the Settings panel as a file (settings.json): sections and labels as in the
// UI, choices by their option text. examples/settings-default.json shows every entry with its default.
// DOM-free, so the Node test can check examples/settings-default.json against this list.
//   { "Figures": { "Show as": "Ships" }, "Console": { "Audio volume": 60 }, ... }
// Entries a file leaves out keep their current value.

/**
 * @typedef {{ section: string, label: string, key: string, type: 'choice'|'number'|'bool',
 *   options?: Record<string, string>, min?: number, max?: number, values?: number[],
 *   default: string|number|boolean }} Setting
 * `key` is the control id / store key; `options` maps choice values to the option text.
 */

/** @type {Setting[]} in the order of the UI */
export const SETTINGS = [
  { section: 'Figures', label: 'Show as', key: 'view-figures', type: 'choice', options: { basic: 'Basic', ships: 'Ships' }, default: 'basic' },
  { section: 'Console', label: 'Boot from', key: 'boot-from', type: 'choice', options: { game: 'Game', menu: 'Console menu' }, default: 'game' },
  { section: 'Console', label: 'Audio volume', key: 'volume', type: 'number', min: 0, max: 100, default: 80 },
  { section: 'Console', label: 'Console size', key: 'console-size', type: 'number', min: 25, max: 45, default: 33 },
  { section: 'Console', label: 'Show OS keys', key: 'view-os-keys', type: 'bool', default: false },
  { section: 'Console Overlay', label: 'Opacity', key: 'overlay-opacity', type: 'number', min: 0, max: 100, default: 60 },
  { section: 'Console Overlay', label: 'Rotate 90°', key: 'overlay-rot', type: 'number', values: [0, 90, 180, 270], default: 0 },
  { section: 'Console Overlay', label: 'Rotate', key: 'overlay-tilt', type: 'number', min: -20, max: 20, default: 0 },
  { section: 'Console Overlay', label: 'Zoom', key: 'overlay-zoom', type: 'number', min: -50, max: 50, default: 0 },
  { section: 'Console Overlay', label: 'LED display', key: 'overlay-leds', type: 'number', min: 30, max: 56, default: 44 },
  { section: 'Console Overlay', label: 'Stretch ↔', key: 'overlay-sx', type: 'number', min: -25, max: 25, default: 0 },
  { section: 'Console Overlay', label: 'Stretch ↕', key: 'overlay-sy', type: 'number', min: -25, max: 25, default: 0 },
  { section: 'Console Overlay', label: 'Left/right', key: 'overlay-x', type: 'number', min: -25, max: 25, default: 0 },
  { section: 'Console Overlay', label: 'Up/down', key: 'overlay-y', type: 'number', min: -25, max: 25, default: 0 },
  { section: 'Additional Overlays & Views', label: 'Antenna Areas', key: 'view-areas', type: 'choice', options: { never: 'Never', interact: 'On interact', always: 'Always' }, default: 'interact' },
  { section: 'Additional Overlays & Views', label: 'Unused Antennas', key: 'view-unused', type: 'bool', default: false },
  { section: 'Additional Overlays & Views', label: 'Antenna Ids', key: 'view-antenna-ids', type: 'bool', default: false },
  { section: 'Additional Overlays & Views', label: 'Console Button Ids', key: 'view-key-ids', type: 'bool', default: false },
  { section: 'Fullscreen', label: 'Keep the screen awake while playing', key: 'wake-lock', type: 'bool', default: true },
];
// Not here on purpose: Game Seed (#game-seed). It is random at every Power on, so it is neither saved
// in the settings file nor stored (ui/app.js).
const BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

/** @param {string} key */
export function defaultOf(key) {
  const s = BY_KEY.get(key);
  if (!s) throw new Error(`unknown setting ${key}`);
  return s.default;
}

/** The value of `raw` for setting `s`, or an error message. */
function check(s, raw) {
  if (s.type === 'bool') return typeof raw === 'boolean' ? { value: raw } : { error: 'must be true or false' };
  if (s.type === 'choice') {
    const hit = Object.entries(s.options).find(([v, text]) => typeof raw === 'string'
      && (text.toLowerCase() === raw.toLowerCase() || v === raw.toLowerCase()));
    return hit ? { value: hit[0] } : { error: `must be one of ${Object.values(s.options).map(t => `"${t}"`).join(', ')}` };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: 'must be a number' };
  if (s.values) return s.values.includes(raw) ? { value: raw } : { error: `must be one of ${s.values.join(', ')}` };
  return raw >= s.min && raw <= s.max ? { value: raw } : { error: `must be between ${s.min} and ${s.max}` };
}

/**
 * Read a settings file (already parsed JSON). Unknown entries and bad values are reported and skipped.
 * @returns {{ values: Map<string, string|number|boolean>, errors: string[] }}
 */
export function parseSettings(json) {
  const values = new Map(), errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { values, errors: ['not a settings object'] };
  for (const [section, entries] of Object.entries(json)) {
    const known = SETTINGS.filter(s => s.section === section);
    if (!known.length) { errors.push(`unknown section "${section}"`); continue; }
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) { errors.push(`"${section}" must be an object`); continue; }
    for (const [label, raw] of Object.entries(entries)) {
      const s = known.find(k => k.label === label);
      if (!s) { errors.push(`${section} → unknown entry "${label}"`); continue; }
      const r = check(s, raw);
      if ('error' in r) errors.push(`${section} → ${label}: ${r.error}`);
      else values.set(s.key, r.value);
    }
  }
  return { values, errors };
}

/**
 * Build a settings file with every entry.
 * @param {(key: string) => string|number|boolean} get  the current value of a setting
 */
export function settingsFile(get) {
  const out = {};
  for (const s of SETTINGS) {
    const v = get(s.key);
    (out[s.section] ??= {})[s.label] = s.type === 'choice' ? s.options[v] : v;
  }
  return out;
}

/** settingsFile as text: one section per line block, like settings-default.json. */
export function settingsText(file) {
  return JSON.stringify(file, null, 2) + '\n';
}
