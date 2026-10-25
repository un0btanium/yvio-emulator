#!/usr/bin/env node
// Headless runner for the emulator core (yvio-emulator/*).
//   node test/run.js [--card DIR]... [--app PATH] [--language CODE] [--trace] [--quiet-time] [--until-wav] [--ms N] [--wav OUT] [--slice N] [--display] [--press MS:KEY[:HOLD],...]
//   node test/run.js test/scripts/GAME/NAME.json [options]   run a test script (see test/scripts/README.md); exit 1 on failure
// --card may repeat; later cards override files of earlier ones. Without --card it uses cards/freibeuter-der-karibik/original
// (cards/ is git-ignored: put or link your own SD-card copies there as cards/GAME/VERSION/;
// YVIO_CARDS sets another folder). --language selects a language of the game's lang.txt
// (e.g. "en" on Freibeuter der Karibik 1.1), as the page's Language choice does.

import { performance } from 'node:perf_hooks';
import { vfsFromDirs } from './node-files.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { Machine, AUDIO_RATE } from '../yvio-emulator/machine.js';
import { createCpu } from '../yvio-emulator/cpu.js';
import { toAscii } from '../yvio-emulator/display.js';

const args = process.argv.slice(2);
const opt = { cards: [], app: 'pirates/app.elf', trace: false, quietTime: false, untilWav: false, ms: 10000, wav: null, slice: undefined, display: false, presses: [], files: false, language: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--card') opt.cards.push(args[++i]);
  else if (a === '--app') opt.app = args[++i];
  else if (a === '--language') opt.language = args[++i];
  else if (a === '--trace') opt.trace = true;
  else if (a === '--quiet-time') opt.quietTime = true;
  else if (a === '--until-wav') opt.untilWav = true;
  else if (a === '--ms') opt.ms = Number(args[++i]);
  else if (a === '--wav') opt.wav = args[++i];
  else if (a === '--slice') opt.slice = Number(args[++i]);
  else if (a === '--display') opt.display = true;
  else if (a === '--files') opt.files = true;
  else if (a === '--press') opt.presses = args[++i].split(',').map(p => { const [at, key, hold = 150] = p.split(':').map(Number); return { at, key, hold }; });
  else if (!a.startsWith('--') && a.endsWith('.json')) opt.script = JSON.parse(readFileSync(a, 'utf8'));
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
const cardsDir = (process.env.YVIO_CARDS ?? new URL('../cards', import.meta.url).pathname).replace(/\/?$/, '/');
const script = opt.script;
if (script) {
  if (!opt.cards.length) for (const c of script.cards ?? ['freibeuter-der-karibik/original']) opt.cards.push(cardsDir + c);
  if (script.app) opt.app = script.app;
  if (script.language) opt.language ??= script.language;
  opt.ms = script.timeoutMs ?? 120000;
  opt.files = opt.files || !!script.verbose;
  console.log(`script: ${script.description ?? '(no description)'}`);
}
if (!opt.cards.length) opt.cards.push(cardsDir + 'freibeuter-der-karibik/original');

const t0 = performance.now();
const cpu = await createCpu('unicorn');
const tCpu = performance.now() - t0;
const vfs = vfsFromDirs(...opt.cards);
if (opt.language) {
  const game = opt.app.split('/').slice(0, -1).join('/');
  if (!vfs.setLanguage(game, opt.language)) {
    const langs = vfs.languages(game);
    console.error(`${game} has no language "${opt.language}" (lang.txt: ${langs ? langs.languages.map(l => l.code).join(', ') : 'none'})`);
    process.exit(2);
  }
}
const NOISY = new Set(['os_get_time_ms']);
let wavHit = null;
const recent = [];
const m = await Machine.create({
  vfs, appPath: opt.app, cpu, slice: opt.slice,
  log: line => console.log(`[log] ${line}`),
  trace: (t, task, n, text) => {
    const line = `[${t.toFixed(3).padStart(10)} ms] ${task.padEnd(16)} ${text}`;
    recent.push(line); if (recent.length > 40) recent.shift();
    if (opt.trace && !(opt.quietTime && NOISY.has(text.slice(0, text.indexOf('('))))) console.log(line);
  },
});
const opened = []; // {t, path} of successful fopens
m.kuma.on.fileOpen = (path, ok) => {
  if (ok) opened.push({ t: m.kernel.timeMs, path });
  if (opt.trace || opt.files) console.log(`[file @ ${m.kernel.timeMs.toFixed(0)} ms] fopen ${path} ${ok ? 'ok' : 'FAILED'}`);
  if (ok && /\.wav$/i.test(path) && !wavHit) wavHit = path;
};
let lastFrame = '';
m.kuma.on.display = fb => {
  const hex = Buffer.from(fb).toString('hex');
  if (opt.trace) console.log(`[display] ${hex}`);
  if (opt.display && hex !== lastFrame) console.log(`[frame @ ${m.kernel.timeMs.toFixed(0)} ms]\n${toAscii(fb)}`);
  lastFrame = hex;
};

const pcm = [];
let audioPeak = 0;
m.onAudio = buf => {
  for (const v of buf) audioPeak = Math.max(audioPeak, Math.abs(v));
  if (opt.wav) pcm.push(buf.slice());
};

// Script steps: wait for a file open (or an absolute time), then delay, then press a key.
const steps = (script?.steps ?? []).map(s => ({ ...s, re: s.afterFile ? new RegExp(s.afterFile, 'i') : null }));
let stepIdx = 0, stepFrom = 0, pressAt = null;
const expect = (script?.expectFiles ?? []).map(e => new RegExp(e, 'i'));
function expectMatched() {
  let i = 0;
  for (const f of opened) if (i < expect.length && expect[i].test(f.path)) i++;
  return i;
}
function advanceSteps(now) {
  while (stepIdx < steps.length) {
    const st = steps[stepIdx];
    if (pressAt === null) {
      let t0 = null;
      if (st.re) { const f = opened.slice(stepFrom).find(f => st.re.test(f.path)); if (f) t0 = f.t; }
      else t0 = st.at ?? now;
      if (t0 === null) return;
      pressAt = t0 + (st.delay ?? 0);
      if (st.key !== undefined) opt.presses.push({ at: pressAt, key: st.key, hold: st.hold ?? 150 });
    }
    if (now < pressAt) return;
    if (st.place) {
      // {"place": {"ship": 1..4, "antenna": 0..20 | null}}
      const f = m.kuma.board.figures[st.place.ship - 1];
      m.kuma.board.place(f, st.place.antenna ?? null);
      if (opt.files) console.log(`[board @ ${now.toFixed(0)} ms] ship ${st.place.ship} -> antenna ${st.place.antenna ?? 'off'}`);
    }
    stepFrom = opened.length; stepIdx++; pressAt = null;
  }
}

const tRun = performance.now();
let result;
while (true) {
  const now = m.kernel.timeMs;
  if (script) {
    advanceSteps(now);
    if (stepIdx >= steps.length && expectMatched() === expect.length) { result = 'script done'; break; }
  }
  let keys = 0;
  for (const p of opt.presses) if (now >= p.at && now < p.at + p.hold) keys |= 1 << p.key;
  if (keys !== m.kuma.keys) { if (opt.trace || opt.files) console.log(`[keys @ ${now.toFixed(0)} ms] 0x${keys.toString(16)}`); m.kuma.keys = keys; }
  result = m.runFor(10);
  if (result !== 'time') break;
  if (opt.untilWav && wavHit) { result = `first wav: ${wavHit}`; break; }
  if (m.kernel.timeMs >= opt.ms) break;
}
const wall = performance.now() - tRun;

console.log('---');
console.log(`result: ${result}${m.halted ? ' — ' + m.halted : ''}`);
if (m.fault || (m.halted && !/^app returned|^os_exec/.test(m.halted))) {
  console.log('last syscalls:\n' + recent.join('\n'));
  for (const t of m.kernel.tasks) console.log(m.dumpTask(t));
}
const vms = m.kernel.timeMs;
console.log(`unicorn load ${tCpu.toFixed(0)} ms; ran ${vms.toFixed(1)} ms virtual in ${wall.toFixed(0)} ms wall ` +
  `(${(vms / wall).toFixed(2)}x real time); ${m.syscalls} syscalls; ` +
  `>= ${(m.instructions / 1e6).toFixed(1)} M instr in full slices (${(m.instructions / wall / 1e3).toFixed(1)} MIPS)`);
if (m.audioBuffers) console.log(`audio: ${m.audioBuffers} buffers (${(m.audioBuffers * 128 / AUDIO_RATE).toFixed(2)} s), peak ${audioPeak}`);
if (opt.wav) {
  const n = pcm.reduce((a, b) => a + b.length, 0);
  const out = Buffer.alloc(44 + 2 * n);
  out.write('RIFF', 0); out.writeUInt32LE(36 + 2 * n, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(AUDIO_RATE, 24); out.writeUInt32LE(AUDIO_RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(2 * n, 40);
  let o = 44;
  for (const b of pcm) for (const v of b) { out.writeInt16LE(v, o); o += 2; }
  writeFileSync(opt.wav, out);
  console.log(`wrote ${opt.wav} (${n} samples)`);
}
if (script) {
  const got = expectMatched();
  const ok = got === expect.length && stepIdx >= steps.length;
  console.log(`script ${ok ? 'PASSED' : 'FAILED'}: ${got}/${expect.length} expected files, ${stepIdx}/${steps.length} steps`);
  if (!ok) {
    if (got < expect.length) console.log(`  next expected file: /${expect[got].source}/`);
    console.log('  files opened:\n' + opened.map(f => `    ${f.t.toFixed(0).padStart(7)} ms  ${f.path}`).join('\n'));
  }
  process.exitCode = ok ? 0 : 1;
}
console.log(`tasks: ${m.kernel.tasks.map(t => `${t.name}(p${t.prio},${t.state}${t.wait ? ':' + t.wait.kind : ''})`).join(' ')}`);
