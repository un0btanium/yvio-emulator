// The game board with draggable ships, drawn over a picture of the real board when the user
// has one (emulator/board.png on their card copy, or a picture they load; it is game artwork, so
// it is never shipped with the page). Without a picture, a simple map with the same layout is drawn.
// Which antennas sit where comes from the antenna layout (board-layout.js, setLayout).
// A second surface, the tray (shown in a drawer next to the board), holds the antennas that the
// layout does not place on the board and the slots for ships off the board. Ships can be dragged
// between both surfaces, or tapped and then a field tapped (easier on phones).

const NS = 'http://www.w3.org/2000/svg';
// Board picture size; the layout's coordinates are in its pixels (the antenna editor,
// board-editor.js, measures them).
const W = 1024, H = 1024;
/** Ship n (1..4) as announced by the game: player_bl, player_gr, player_re, player_ye. */
export const SHIPS = [
  { n: 1, name: 'Blau', color: '#2f6fd6' },
  { n: 2, name: 'Grün', color: '#2fa84f' },
  { n: 3, name: 'Rot', color: '#d63c2f' },
  { n: 4, name: 'Gelb', color: '#e8b923' },
];
// tray layout (its own coordinates): the off-board slots, then the unused antennas, 3 per row
const TRAY_W = 300;
const DOCK = { x: 10, y: 52, w: 280, h: 210 };
const DOCK_SLOTS = [[80, 110], [220, 110], [80, 205], [220, 205]];
const OTHER_TOP = 360;
const OTHER_STEP = 90, OTHER_R = 34;

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

/**
 * @param {HTMLElement} host       where the board goes
 * @param {(ship:number, antenna:number|null) => void} onPlace
 * @param {HTMLElement} trayHost   where the tray goes (other antennas, ships off the board)
 */
export function createBoard(host, onPlace, trayHost) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'board', role: 'img', 'aria-label': 'Game board' });
  host.append(svg);
  const traySvg = el('svg', { viewBox: `0 0 ${TRAY_W} ${DOCK.y + DOCK.h + 10}`, class: 'board tray', preserveAspectRatio: 'xMidYMin meet', role: 'img', 'aria-label': 'Figures and unused antennas off the board' });
  trayHost.append(traySvg);

  // background: drawn fallback map, covered by the picture once one is available
  const bg = el('g', { class: 'fallback' }, svg);
  el('rect', { x: 0, y: 0, width: W, height: H, rx: 24, class: 'water' }, bg);
  const picture = el('image', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', class: 'picture' }, svg);
  picture.style.display = 'none';

  el('text', { x: 16, y: 36, class: 'docklabel' }, traySvg).textContent = 'Figures';
  el('rect', { x: DOCK.x, y: DOCK.y, width: DOCK.w, height: DOCK.h, rx: 16, class: 'dock' }, traySvg);
  // the unused antennas can be hidden (board.showUnused); the tray then ends below the dock
  const unusedG = el('g', { class: 'unused' }, traySvg);
  el('text', { x: 16, y: OTHER_TOP - 24, class: 'docklabel' }, unusedG).textContent = 'Unused Antennas';
  const trayFieldsG = el('g', {}, unusedG);
  let unusedShown = true;
  // the fields of the current layout (setLayout); the ship tokens are drawn above them
  const labelsG = el('g', {}, bg);  // names, only visible without a picture
  const fieldsG = el('g', {}, svg);
  // drawn by the antenna editor (preview of the antenna being placed)
  const editLayer = el('g', { class: 'edit-layer' }, svg);

  /**
   * A drawing surface: the board or the tray, each with its own coordinates.
   * @typedef {{ svg: SVGSVGElement, spots: Map<number, {x:number, y:number, r:number}>, scale: number }} Surface
   */
  /** @type {Surface} */
  const boardS = { svg, spots: new Map(), scale: 2.6 };
  /** @type {Surface} */
  const trayS = { svg: traySvg, spots: new Map(), scale: 2.1 };
  const surfaces = [boardS, trayS];

  /** unused antennas of the current layout */
  let unused = [];
  /** Draw the fields of a layout: the listed antennas on the board, the others in the tray. */
  function drawFields(/** @type {import('./board-layout.js').BoardLayout} */ lay) {
    fieldsG.replaceChildren(); labelsG.replaceChildren(); trayFieldsG.replaceChildren();
    boardS.spots.clear(); trayS.spots.clear();
    const field = (parent, a, x, y, r, cls, title) => {
      const g = el('g', { class: `field ${cls}`, 'data-antenna': a }, parent);
      el('circle', { cx: x, cy: y, r }, g);
      el('text', { x: x + r * 0.62, y: y - r * 0.62, class: 'num' }, g).textContent = String(a);
      el('title', {}, g).textContent = title;
    };
    for (const [a, { x, y, r, name }] of lay.spots) {
      boardS.spots.set(a, { x, y, r });
      field(fieldsG, a, x, y, r, 'board-field', name ? `${name} (antenna ${a})` : `Antenna ${a}`);
      if (name) el('text', { x, y: y + 10, class: 'label' }, labelsG).textContent = name;
    }
    unused = lay.unused;
    unused.forEach((a, i) => {
      const x = 60 + (i % 3) * OTHER_STEP, y = OTHER_TOP + 30 + Math.floor(i / 3) * OTHER_STEP;
      trayS.spots.set(a, { x, y, r: OTHER_R });
      field(trayFieldsG, a, x, y, OTHER_R, 'tray-field', `Antenna ${a} (not on the board)`);
    });
  }
  /** Size the tray to what it shows: the dock, plus the unused antennas if they are shown. */
  function sizeTray() {
    const rows = unusedShown ? Math.ceil(unused.length / 3) : 0;
    unusedG.style.display = rows ? '' : 'none';
    const h = rows ? OTHER_TOP + rows * OTHER_STEP - 10 : DOCK.y + DOCK.h + 10;
    traySvg.setAttribute('viewBox', `0 0 ${TRAY_W} ${h}`);
  }
  /** Lay out the ships; those on an antenna that is no longer shown go off the board first. */
  function dropHidden() {
    const shown = a => boardS.spots.has(a) || (unusedShown && trayS.spots.has(a));
    const gone = [...where].filter(([, a]) => a !== null && !shown(a)).map(([n]) => n);
    for (const n of gone) where.set(n, null);
    layout();
    for (const n of gone) onPlace(n, null);
  }
  drawFields({ spots: new Map(), unused: [] });

  /** ship n -> antenna or null */
  const where = new Map(SHIPS.map(s => [s.n, null]));
  const tokens = new Map();
  for (const s of SHIPS) {
    const g = el('g', { class: 'ship', tabindex: 0, 'data-ship': s.n });
    el('title', {}, g).textContent = `Schiff ${s.name} (${s.n})`;
    const body = el('g', { class: 'body' }, g);
    el('circle', { cx: 0, cy: 0, r: 17, class: 'halo' }, body);
    el('circle', { cx: 0, cy: 0, r: 14, fill: s.color, class: 'dot' }, body); // "Basic" figures
    el('path', { d: 'M-14 4 L14 4 L9 12 L-9 12 Z', fill: s.color, class: 'hull' }, body);
    el('path', { d: 'M-1 -14 L-1 3 M0 -14 L11 1 L0 1 Z', fill: '#fff', stroke: s.color, 'stroke-width': 2, class: 'sail' }, body);
    tokens.set(s.n, g);
  }
  /** Put a token on a surface at (x, y) of that surface. */
  function moveToken(g, s, x, y) {
    if (g.ownerSVGElement !== s.svg) s.svg.append(g);
    g.querySelector('.body').setAttribute('transform', `scale(${s.scale})`);
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  }
  const surfaceOf = antenna => (antenna !== null && boardS.spots.has(antenna) ? boardS : trayS);

  let selected = null;
  function layout() {
    const count = new Map();
    for (const s of SHIPS) {
      const a = where.get(s.n);
      const surf = surfaceOf(a);
      let x, y;
      if (a === null) [x, y] = DOCK_SLOTS[s.n - 1];
      else {
        const p = surf.spots.get(a);
        const k = count.get(a) ?? 0;
        count.set(a, k + 1);
        const d = surf === boardS ? 1 : 0.5;
        x = p.x + [0, 40, -40, 0][k] * d; y = p.y + [0, 22, 22, 44][k] * d;
      }
      const g = tokens.get(s.n);
      moveToken(g, surf, x, y);
      g.classList.toggle('selected', selected === s.n);
    }
    for (const surf of surfaces) surf.svg.classList.toggle('placing', selected !== null);
  }

  function place(n, antenna) {
    where.set(n, antenna);
    selected = null;
    layout();
    onPlace(n, antenna);
  }

  const toSvg = (s, e) => {
    const pt = s.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(s.svg.getScreenCTM().inverse());
  };
  /** The visible surface under the pointer, or null. */
  function surfaceAt(e) {
    for (const s of surfaces) {
      const r = s.svg.getBoundingClientRect();
      if (r.width && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return s;
    }
    return null;
  }
  function fieldAt(s, p) {
    let best = null, bestD = Infinity;
    for (const [a, f] of s.spots) {
      if (!unusedShown && s === trayS) break;
      const d = Math.hypot(p.x - f.x, p.y - f.y);
      if (d < f.r + 20 && d < bestD) { best = a; bestD = d; }
    }
    return best;
  }
  /** Drop ship n where the pointer is: a field, anywhere else in the tray = off the board. */
  function dropAt(n, e) {
    const s = surfaceAt(e);
    if (!s) return false;
    const a = fieldAt(s, toSvg(s, e));
    if (a !== null) place(n, a);
    else if (s === trayS) place(n, null);
    else return false;
    return true;
  }

  let drag = null;
  for (const s of surfaces) {
    s.svg.addEventListener('pointerdown', e => {
      const g = e.target.closest('.ship');
      if (!g) return;
      e.preventDefault();
      drag = { n: Number(g.dataset.ship), x: e.clientX, y: e.clientY, moved: false, g };
      g.classList.add('dragging');
      for (const t of surfaces) t.svg.classList.add('placing');
    });
    s.svg.addEventListener('keydown', e => {
      const g = e.target.closest?.('.ship');
      if (g && (e.key === 'Enter' || e.key === ' ')) { selected = Number(g.dataset.ship); layout(); e.preventDefault(); }
    });
  }
  // move/up are tracked on the window, so a drag can go from the tray to the board
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag.moved = true;
    if (!drag.moved) return;
    const s = surfaceAt(e) ?? surfaces.find(t => t.svg === drag.g.ownerSVGElement);
    const p = toSvg(s, e);
    moveToken(drag.g, s, p.x, p.y);
  });
  window.addEventListener('pointerup', e => {
    if (drag) {
      const { n, moved, g } = drag;
      g.classList.remove('dragging');
      drag = null;
      if (moved) { if (!dropAt(n, e)) layout(); }
      else { selected = selected === n ? null : n; layout(); }
      return;
    }
    // tap on a field (or the tray) while a ship is selected
    if (selected !== null && surfaces.some(s => s.svg.contains(/** @type {Node} */ (e.target)))) dropAt(selected, e);
  });
  window.addEventListener('pointercancel', () => { if (drag) { drag.g.classList.remove('dragging'); drag = null; layout(); } });

  sizeTray();
  layout();
  return {
    /** current placements as [ship, antenna|null] pairs */
    placements: () => [...where.entries()],
    place,
    /** Show or hide the unused antennas; ships on one go off the board when they are hidden. */
    showUnused(on) {
      unusedShown = on;
      sizeTray();
      dropHidden();
    },
    /** Use an antenna layout (board-layout.js); ships keep their antenna if it is still shown. */
    setLayout(lay) {
      drawFields(lay);
      sizeTray();
      dropHidden();
    },
    /** for the antenna editor: the board svg, pointer position in board pixels, preview layer */
    svg,
    toBoard: e => toSvg(boardS, e),
    editLayer,
    /** Antenna editor on/off: areas and ids always shown, no ship selected. */
    setEditing(on) {
      svg.classList.toggle('editing', on);
      if (selected !== null) { selected = null; layout(); }
    },
    /** Show a picture of the real board (URL), or null for the drawn map. */
    setPicture(url) {
      if (url) picture.setAttribute('href', url);
      picture.style.display = url ? '' : 'none';
      svg.classList.toggle('has-picture', !!url);
    },
  };
}
