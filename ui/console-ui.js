// The emulated console: the key ring around the 12×12 LED display, key input (pointer) and
// the overlay picture of the printed sheet. The overlay controls are found by id
// in the page (#pick-overlay, #overlay-*).

import { pixel, keyLed, SIZE } from '../yvio-emulator/display.js';
import { defaultOf } from './settings.js';

const $ = id => document.getElementById(id);

/** localStorage wrapper for per-viewer conveniences; never throws. */
export const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
};

// Keys 0..11 sit evenly on a circle around the display like the hours of a clock: key 0 at
// 12 o'clock, key 6 (OK) at 6 o'clock, increasing clockwise. Each key has three LEDs in a
// triangle: yellow at the corner pointing to the display, green to its right, red to its left.
const RING_RADIUS = 40;            // % of the device size
const KEY_HINT = { 6: 'OK', 7: 'skip', 8: '↻' };
/** Framebuffer channel bit (fb[2k] bit 4 + c) -> LED colour: 0 yellow (marks the active key), 1 green,
 *  2 red, confirmed on real hardware. */
const LED_OF_CHANNEL = ['y', 'g', 'r'];

/**
 * @param {HTMLElement} device  element with the #leds canvas and the #overlay img
 * @param {{ onKeys: (mask:number) => void }} opts  onKeys gets the new key mask on every change
 */
export function createConsole(device, { onKeys }) {
  /** @type {HTMLButtonElement[]} */
  const keyButtons = [];
  for (let k = 0; k < 12; k++) {
    const angle = k * 30; // degrees clockwise from 12 o'clock
    const rad = angle * Math.PI / 180;
    const b = document.createElement('button');
    b.className = 'key';
    b.dataset.key = String(k);
    b.style.left = `${50 + RING_RADIUS * Math.sin(rad)}%`;
    b.style.top = `${50 - RING_RADIUS * Math.cos(rad)}%`;
    // the triangle is drawn for key 6 (pointing up at the display) and rotated around the ring
    b.innerHTML = `<span class="tri" style="rotate:${angle - 180}deg"><i class="y"></i><i class="g"></i><i class="r"></i></span>` +
      `<span class="label" style="translate:${(22 * Math.sin(rad)).toFixed(1)}% ${(-22 * Math.cos(rad)).toFixed(1)}%">${k}${KEY_HINT[k] ? `<small>${KEY_HINT[k]}</small>` : ''}</span>`;
    b.title = `Key ${k}`;
    device.append(b);
    keyButtons[k] = b;
  }

  // ---- LED display -----------------------------------------------------------------------
  const canvas = /** @type {HTMLCanvasElement} */ (device.querySelector('#leds'));
  const ctx = canvas.getContext('2d');
  let fb = new Uint8Array(24);

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const css = canvas.clientWidth || 240;
    const px = Math.round(css * dpr);
    if (canvas.width !== px) { canvas.width = canvas.height = px; }
    const cell = px / SIZE;
    const style = getComputedStyle(document.documentElement);
    const on = style.getPropertyValue('--led-on').trim() || '#ff5a2a';
    const off = style.getPropertyValue('--led-off').trim() || '#3a1810';
    ctx.clearRect(0, 0, px, px);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // bit x = 0 is the rightmost column
        const lit = pixel(fb, x, y);
        ctx.fillStyle = lit ? on : off;
        ctx.shadowColor = lit ? on : 'transparent';
        ctx.shadowBlur = lit ? cell * 0.5 : 0;
        ctx.beginPath();
        ctx.arc((SIZE - 1 - x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    for (let k = 0; k < 12; k++) {
      const c = keyLed(fb, k);
      LED_OF_CHANNEL.forEach((led, ch) => keyButtons[k].querySelector(`.tri .${led}`).classList.toggle('on', ((c >> ch) & 1) === 1));
    }
  }
  new ResizeObserver(draw).observe(canvas);
  draw();

  // ---- keys ------------------------------------------------------------------------------
  // Keys 12..14 (menu, 13, 14) are .key buttons elsewhere in the page; they work the same way.
  let keyMask = 0;
  function setKey(k, down) {
    const bit = 1 << k;
    const next = down ? keyMask | bit : keyMask & ~bit;
    if (next === keyMask) return;
    keyMask = next;
    document.querySelectorAll(`.key[data-key="${k}"]`).forEach(b => b.classList.toggle('pressed', down));
    onKeys(keyMask);
  }
  const releaseAll = () => { for (let k = 0; k < 15; k++) setKey(k, false); };
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest?.('.key');
    if (!b) return;
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    setKey(Number(b.dataset.key), true);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, e => {
      const b = e.target.closest?.('.key');
      if (b) setKey(Number(b.dataset.key), false);
    });
  }
  document.addEventListener('contextmenu', e => { if (e.target.closest?.('.key')) e.preventDefault(); });
  window.addEventListener('blur', releaseAll);

  const overlay = setupOverlay(/** @type {HTMLImageElement} */ (device.querySelector('#overlay')));

  return {
    /** Show a new framebuffer (24 bytes). */
    show(next) { fb = next; requestAnimationFrame(draw); },
    draw,
    releaseAll,
    /** Show the overlay picture that came with the card (emulator/console_overlay.png). */
    setCardOverlay: overlay.setCardOverlay,
    overlaySettings: overlay.overlaySettings,
    setOverlaySettings: overlay.setOverlaySettings,
  };
}

// ---- console overlay ---------------------------------------------------------------------
// A picture of the printed overlay sheet that comes with the game, drawn over the console.
// Like the board picture it is game artwork and never shipped: emulator/console_overlay.png on
// the user's card copy, or a picture they choose.
// Alignment = where the disc is in the picture (centre cx, cy and radius r as fractions of the
// picture width/height, rot in degrees) plus the user's adjustment on top (rot in 90° steps,
// fine tilt in degrees, zoom and stretch sx/sy in %, dx/dy in % of the console size, and the size
// of the LED display in % of the console, to match the sheet's display window), which is
// remembered per picture name.
/** Measured for the user's console_overlay.png (upright photo, OK at the bottom). The radius is
 *  chosen so that the printed key circles sit on the emulated keys, not the disc edge. */
const OVERLAY_DEFAULT = { rot: 0, cx: 0.5, cy: 0.478, r: 0.48 };
/** Any other picture: assumed upright and filling the frame until the user adjusts it. */
const OVERLAY_PLAIN = { rot: 0, cx: 0.5, cy: 0.5, r: 0.5 };
/** Setting key (settings.js) -> field of the adjustment; "Up/down" is dy with the sign flipped. */
const ADJUST_FIELD = { 'overlay-rot': 'rot', 'overlay-tilt': 'tilt', 'overlay-zoom': 'zoom', 'overlay-leds': 'leds',
  'overlay-sx': 'sx', 'overlay-sy': 'sy', 'overlay-x': 'dx', 'overlay-y': 'dy' };
const toField = (key, v) => (key === 'overlay-y' ? -v || 0 : v);
const NO_ADJUST = Object.fromEntries(Object.entries(ADJUST_FIELD).map(([k, f]) => [f, toField(k, defaultOf(k))]));
const OVERLAY_OPACITY = defaultOf('overlay-opacity'); // %

/** @param {HTMLImageElement} overlay */
function setupOverlay(overlay) {
  let overlayName = '', overlayBase = OVERLAY_PLAIN, overlayAdjust = { ...NO_ADJUST };
  /** adjustment from a settings file that came before any overlay picture: used for the next one */
  let pending = null;

  function placeOverlay() {
    const { cx, cy, r } = overlayBase, a = overlayAdjust;
    const w = overlay.naturalWidth || 1, h = overlay.naturalHeight || 1;
    const rot = overlayBase.rot + a.rot;
    // stretch along the screen axes: width/height are applied before the rotation
    const [sx, sy] = Math.abs(rot / 90) % 2 === 1 ? [a.sy, a.sx] : [a.sx, a.sy];
    const zoom = 50 / r * (1 + a.zoom / 100);      // % of the console size
    const width = zoom * (1 + sx / 100);
    const height = zoom * h / w * (1 + sy / 100);
    Object.assign(overlay.style, {
      width: `${width}%`, height: `${height}%`,
      left: `${50 - cx * width + a.dx}%`, top: `${50 - cy * height + a.dy}%`,
      transformOrigin: `${cx * 100}% ${cy * 100}%`,
      rotate: `${rot + a.tilt}deg`,
    });
    $('leds').style.setProperty('--leds', `${a.leds}%`);
    $('overlay-leds').value = String(a.leds);
    $('overlay-tilt').value = String(a.tilt);
    $('overlay-zoom').value = String(a.zoom);
    $('overlay-sx').value = String(a.sx);
    $('overlay-sy').value = String(a.sy);
    $('overlay-x').value = String(a.dx);
    $('overlay-y').value = String(-a.dy); // slider right = up
  }

  function setOverlay(url, name, base) {
    overlayName = name;
    overlayBase = base;
    overlayAdjust = { ...NO_ADJUST, ...store.get(`overlay-adjust:${name}`), ...pending };
    if (pending) store.set(`overlay-adjust:${name}`, overlayAdjust);
    pending = null;
    overlay.onload = () => { overlay.hidden = false; placeOverlay(); };
    overlay.src = url;
    $('overlay-adjust').hidden = false;
    $('overlay-status').textContent = `Using ${name}`;
  }

  function adjustOverlay(change) {
    Object.assign(overlayAdjust, change);
    overlayAdjust.rot %= 360;
    store.set(`overlay-adjust:${overlayName}`, overlayAdjust);
    placeOverlay();
  }

  function setOverlayOpacity() {
    overlay.style.opacity = String(Number($('overlay-opacity').value) / 100);
    store.set('overlay-opacity', Number($('overlay-opacity').value));
  }

  $('pick-overlay').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) setOverlay(URL.createObjectURL(f), f.name, OVERLAY_PLAIN);
  });
  $('overlay-opacity').value = String(store.get('overlay-opacity') ?? OVERLAY_OPACITY);
  setOverlayOpacity();
  $('overlay-opacity').addEventListener('input', setOverlayOpacity);
  $('overlay-rotate').addEventListener('click', () => adjustOverlay({ rot: overlayAdjust.rot + 90 }));
  $('overlay-reset').addEventListener('click', () => {
    $('overlay-opacity').value = String(OVERLAY_OPACITY);
    setOverlayOpacity();
    adjustOverlay({ ...NO_ADJUST });
  });
  $('overlay-tilt').addEventListener('input', e => adjustOverlay({ tilt: Number(e.target.value) }));
  $('overlay-zoom').addEventListener('input', e => adjustOverlay({ zoom: Number(e.target.value) }));
  $('overlay-leds').addEventListener('input', e => adjustOverlay({ leds: Number(e.target.value) }));
  $('overlay-sx').addEventListener('input', e => adjustOverlay({ sx: Number(e.target.value) }));
  $('overlay-sy').addEventListener('input', e => adjustOverlay({ sy: Number(e.target.value) }));
  $('overlay-x').addEventListener('input', e => adjustOverlay({ dx: Number(e.target.value) }));
  $('overlay-y').addEventListener('input', e => adjustOverlay({ dy: -Number(e.target.value) }));

  return {
    /** The overlay settings (settings.js keys) of the current picture, or of the next one. */
    overlaySettings() {
      const a = { ...overlayAdjust, ...pending };
      const out = { 'overlay-opacity': Number($('overlay-opacity').value) };
      for (const [key, f] of Object.entries(ADJUST_FIELD)) out[key] = toField(key, a[f]);
      return out;
    },
    /** Apply overlay settings (settings.js keys); without a picture they wait for the next one. */
    setOverlaySettings(values) {
      if ('overlay-opacity' in values) {
        $('overlay-opacity').value = String(values['overlay-opacity']);
        setOverlayOpacity();
      }
      const change = {};
      for (const [key, f] of Object.entries(ADJUST_FIELD)) if (key in values) change[f] = toField(key, values[key]);
      if (!Object.keys(change).length) return;
      if (overlayName) adjustOverlay(change);
      else pending = { ...pending, ...change };
    },
    /** @param {string} url  @param {string} status  shown as "Using …" */
    setCardOverlay(url, status) {
      setOverlay(url, 'console_overlay.png', OVERLAY_DEFAULT);
      $('overlay-status').textContent = `Using ${status}`;
    },
  };
}
