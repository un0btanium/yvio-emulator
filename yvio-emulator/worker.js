// Dedicated module worker that runs the emulated console, paced to the wall clock.
//
// Messages in:
//   {type:'boot', files:[[path, ArrayBuffer], ...], appPath?, audioPort?: MessagePort, volume?}
//   {type:'volume', value}       set the console volume 0..255 (the page's slider)
//   {type:'keys', mask}          os_get_keys bitmask (bit n = key n held)
//   {type:'place', ship, antenna}  put ship 1..4 on an antenna (null = off the board)
//   (boot also takes placements: [[ship, antenna|null], ...])
//   {type:'pause'} / {type:'resume'}
//   {type:'shutdown'}            stop; the card files go back in a 'files' message
// Messages out:
//   {type:'display', fb:Uint8Array(24)}        on every change
//   {type:'file', path, ok, t}                 every fopen
//   {type:'status', app, virtualMs, speed, halted?}  about twice a second
//   {type:'log', text}
//   {type:'volume', value}                     the app changed the console volume (0..255)
//   {type:'files-changed', path, data}         a file the app wrote (fclose after fwrite)
//   {type:'files', files:[[path, ArrayBuffer], ...]}  after shutdown (buffers transferred)
// PCM goes straight to the AudioWorklet through audioPort as Int16Array chunks (22050 Hz mono).

import { Vfs } from './files.js';
import { Machine } from './machine.js';
import { Board } from './board.js';

const TICK_MS = 10;          // scheduling interval
const LEAD_MS = 60;          // run this far ahead of the wall clock (audio prebuffer)
const MAX_LAG_MS = 500;      // if further behind, let game time slip instead of fast-forwarding
const BUDGET_MS = 30;        // max wall time spent emulating per tick

let vfs = null, m = null, audioPort = null;
const board = new Board(); // survives app restarts, like the real board
let keys = 0, paused = false, timer = 0;
let clockBase = 0;           // wall time (ms) that corresponds to virtual time 0 of this app run
let lastStatus = 0, lastWall = 0, lastVirtual = 0, speed = 0;
let pcm = [];
let lastFb = '';
let volume = 0;              // the console volume 0..255; kept across app restarts like the OS's saved one

const post = (msg, transfer) => self.postMessage(msg, transfer ?? []);

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case 'boot':
      vfs = new Vfs();
      for (const [path, buf] of data.files) vfs.add(path, new Uint8Array(buf));
      audioPort = data.audioPort ?? null;
      volume = data.volume ?? 0;
      for (const [ship, antenna] of data.placements ?? []) board.place(board.figures[ship - 1], antenna);
      await boot(data.appPath ?? 'pirates/app.elf');
      break;
    case 'keys':
      keys = data.mask >>> 0;
      if (m) m.kuma.keys = keys;
      break;
    case 'volume':
      volume = data.value;
      m?.kuma.setVolume(volume);
      break;
    case 'place':
      board.place(board.figures[data.ship - 1], data.antenna);
      break;
    case 'pause': paused = true; break;
    case 'resume':
      if (paused && m) clockBase = performance.now() - m.kernel.timeMs;
      paused = false;
      break;
    case 'shutdown':
      shutdown();
      break;
  }
};

async function boot(appPath) {
  clearInterval(timer);
  if (m) { m.cpu.close(); m = null; }
  try {
    m = await Machine.create({ vfs, appPath, board, volume, log: text => post({ type: 'log', text }) });
  } catch (e) {
    // Like the real OS: if the app can't be loaded, fall back to the menu.
    post({ type: 'log', text: `cannot start ${appPath}: ${e.message}` });
    if (appPath !== 'app.elf' && vfs.has('app.elf')) return boot('app.elf');
    post({ type: 'status', app: appPath, virtualMs: 0, speed: 0, halted: e.message });
    return;
  }
  m.kuma.keys = keys;
  m.kuma.on.display = fb => {
    const key = fb.join(',');
    if (key !== lastFb) { lastFb = key; post({ type: 'display', fb: fb.slice() }); }
  };
  m.kuma.on.volume = v => { volume = v; post({ type: 'volume', value: v }); };
  m.kuma.on.fileOpen = (path, ok) => post({ type: 'file', path, ok, t: m.kernel.timeMs });
  m.kuma.on.fileWrite = (path, data) => post({ type: 'files-changed', path, data: data.slice() });
  m.onAudio = buf => pcm.push(buf.slice());
  clockBase = performance.now();
  lastWall = performance.now(); lastVirtual = 0;
  post({ type: 'log', text: `started ${appPath}` });
  timer = setInterval(tick, TICK_MS);
}

function tick() {
  if (!m || paused) return;
  const start = performance.now();
  let target = start - clockBase + LEAD_MS;
  if (target - m.kernel.timeMs > MAX_LAG_MS) {
    clockBase += target - m.kernel.timeMs - LEAD_MS;
    target = m.kernel.timeMs + LEAD_MS;
  }
  while (m.kernel.timeMs < target && performance.now() - start < BUDGET_MS) {
    const r = m.runFor(Math.min(target - m.kernel.timeMs, 20));
    if (r === 'halted') break;
    if (r === 'idle') { m.kernel.timeMs = target; break; }
  }
  flushAudio();
  if (m.halted) return onHalt();
  if (start - lastStatus > 500) {
    speed = (m.kernel.timeMs - lastVirtual) / (start - lastWall);
    lastWall = start; lastVirtual = m.kernel.timeMs; lastStatus = start;
    post({ type: 'status', app: m.appPath, virtualMs: m.kernel.timeMs, speed });
  }
}

/** Stop the machine and hand the card files back to the page (transferred, not copied). */
function shutdown() {
  clearInterval(timer);
  if (m) { m.cpu.close(); m = null; }
  const files = [], transfer = [];
  for (const f of vfs?.files.values() ?? []) {
    const data = f.data.byteOffset === 0 && f.data.byteLength === f.data.buffer.byteLength ? f.data : f.data.slice();
    files.push([f.path, data.buffer]);
    transfer.push(data.buffer);
  }
  vfs = null;
  try { post({ type: 'files', files }, transfer); }
  catch (e) { post({ type: 'log', text: `shutdown: ${e.message}; copying the files` }); post({ type: 'files', files }); }
}

function flushAudio() {
  if (!pcm.length) return;
  const n = pcm.reduce((a, b) => a + b.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const b of pcm) { out.set(b, o); o += b.length; }
  pcm = [];
  if (audioPort) audioPort.postMessage(out, [out.buffer]);
}

function onHalt() {
  clearInterval(timer);
  const e = m.kuma.exitRequest;
  post({ type: 'status', app: m.appPath, virtualMs: m.kernel.timeMs, speed: 0, halted: m.halted });
  if (e?.kind === 'exec') return boot(e.path || 'app.elf');
  if (e?.kind === 'restart') return boot(m.appPath);
  // A crash or a plain return: stay halted so the UI can show the reason.
}
