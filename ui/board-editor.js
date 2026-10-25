// Antenna editor (PC only): place antennas on the board picture to write an antenna layout
// (board-layout.js format). A click on the board sets the centre, a second click the radius
// (a preview follows the mouse; Escape cancels); then a dialog asks for the antenna id and the
// optional name, with the position and radius editable. A click on a placed antenna opens the
// same dialog to change or delete it. Editing starts from the current layout; clear() empties it.
// Every change goes to onChange(list), which shows it.

import { parseBoardLayout, DEFAULT_RADIUS } from './board-layout.js';
import { ANTENNAS } from '../yvio-emulator/board.js';

const NS = 'http://www.w3.org/2000/svg';
const MIN_RADIUS = 30, RADIUS_STEP = 10;   // board pixels
const CLICK_SLOP = 8;                      // screen pixels: more movement is a drag, not a click

const $ = id => document.getElementById(id);
const radiusFor = d => Math.max(MIN_RADIUS, Math.round(d / RADIUS_STEP) * RADIUS_STEP);

/** @typedef {{ antennaId: number, boardCoords: {x:number, y:number}, fallbackName?: string, radius: number }} Entry */

/**
 * @param {{ svg: SVGSVGElement, toBoard: (e: PointerEvent) => DOMPoint, editLayer: SVGGElement }} board
 * @param {(list: Entry[]) => void} onChange
 */
export function createEditor(board, onChange) {
  /** @type {Entry[]} */
  let list = [];
  let active = false;
  /** the centre of the antenna being placed, after the first click */
  let centre = null;
  let down = null;   // pointerdown that may become a click

  const preview = document.createElementNS(NS, 'circle');
  const label = document.createElementNS(NS, 'text');

  function clearPreview() {
    centre = null;
    board.editLayer.replaceChildren();
  }
  function showPreview(e) {
    const p = board.toBoard(e);
    const r = radiusFor(Math.hypot(p.x - centre.x, p.y - centre.y));
    preview.setAttribute('cx', String(centre.x)); preview.setAttribute('cy', String(centre.y));
    preview.setAttribute('r', String(r));
    label.setAttribute('x', String(centre.x)); label.setAttribute('y', String(centre.y + 10));
    label.textContent = `r = ${r}`;
    return r;
  }

  board.svg.addEventListener('pointerdown', e => {
    if (!active || e.button !== 0 || e.target.closest('.ship')) return;
    down = { x: e.clientX, y: e.clientY };
    e.stopPropagation();
  });
  board.svg.addEventListener('pointermove', e => { if (active && centre) showPreview(e); });
  board.svg.addEventListener('pointerup', e => {
    if (!active || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP;
    down = null;
    e.stopPropagation(); // not a tap-to-place for the board
    if (moved) return;
    if (centre) {
      const r = showPreview(e);
      const { x, y } = centre;
      clearPreview();
      openDialog(null, { antennaId: firstFree(), boardCoords: { x, y }, fallbackName: '', radius: r });
      return;
    }
    const field = e.target.closest('.board-field');
    if (field) {
      const i = list.findIndex(en => en.antennaId === Number(field.dataset.antenna));
      if (i >= 0) return openDialog(i, list[i]);
    }
    const p = board.toBoard(e);
    centre = { x: Math.round(p.x), y: Math.round(p.y) };
    board.editLayer.append(preview, label);
    showPreview(e);
  });
  window.addEventListener('keydown', e => { if (active && centre && e.key === 'Escape') clearPreview(); });

  const firstFree = () => {
    for (let a = 0; a < ANTENNAS; a++) if (!list.some(en => en.antennaId === a)) return a;
    return 0;
  };

  // ---- dialog ----------------------------------------------------------------------------
  const dialog = /** @type {HTMLDialogElement} */ ($('antenna-dialog'));
  const idSelect = /** @type {HTMLSelectElement} */ ($('ad-id'));
  for (let a = 0; a < ANTENNAS; a++) idSelect.add(new Option(String(a), String(a)));
  $('ad-radius').min = String(MIN_RADIUS);
  $('ad-radius').step = String(RADIUS_STEP);
  /** index in list of the entry being edited, or null for a new one */
  let editing = null;

  function openDialog(index, entry) {
    editing = index;
    for (const o of idSelect.options) o.disabled = list.some((en, i) => i !== index && en.antennaId === Number(o.value));
    idSelect.value = String(entry.antennaId);
    $('ad-name').value = entry.fallbackName ?? '';
    $('ad-x').value = String(entry.boardCoords.x);
    $('ad-y').value = String(entry.boardCoords.y);
    $('ad-radius').value = String(entry.radius);
    $('ad-title').textContent = index === null ? 'Add antenna' : `Antenna ${entry.antennaId}`;
    $('ad-ok').textContent = index === null ? 'Add' : 'Save';
    $('ad-delete').hidden = index === null;
    $('ad-error').textContent = '';
    dialog.showModal();
  }

  $('ad-cancel').addEventListener('click', () => dialog.close());
  $('ad-delete').addEventListener('click', () => {
    list = list.filter((_, i) => i !== editing);
    dialog.close();
    onChange(list);
  });
  dialog.addEventListener('submit', e => {
    e.preventDefault();
    /** @type {Entry} */
    const entry = {
      antennaId: Number(idSelect.value),
      boardCoords: { x: Number($('ad-x').value), y: Number($('ad-y').value) },
    };
    const name = $('ad-name').value.trim();
    if (name) entry.fallbackName = name;
    entry.radius = Number($('ad-radius').value);
    const next = editing === null ? [...list, entry] : list.map((en, i) => (i === editing ? entry : en));
    try {
      parseBoardLayout({ boardAntennas: next });
    } catch (err) {
      $('ad-error').textContent = err.message.replace(/^boardAntennas\[\d+\]: /, '');
      return;
    }
    list = next;
    dialog.close();
    onChange(list);
  });

  return {
    get active() { return active; },
    /** Start editing with these entries (the current layout). */
    start(entries = []) {
      list = entries.map(en => ({ ...en, radius: en.radius ?? DEFAULT_RADIUS }));
      active = true;
      clearPreview();
    },
    /** Remove all antennas. */
    clear() {
      list = [];
      clearPreview();
      onChange(list);
    },
    /** Stop editing; returns the entries. */
    stop() {
      active = false;
      clearPreview();
      if (dialog.open) dialog.close();
      return list;
    },
  };
}
