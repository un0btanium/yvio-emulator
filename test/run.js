#!/usr/bin/env node
// Headless runner for the emulator core (yvio-emulator/*).
//   node test/run.js [--card DIR]... [--app PATH] [--language CODE] [--trace] [--quiet-time] [--until-wav] [--ms N] [--wav OUT] [--slice N] [--display] [--press MS:KEY[:HOLD],...] [--follow-exec] [--menu-language CODE] [--volume N] [--log-calls SPEC]
//   node test/run.js test/scripts/GAME/NAME.json [options]   run a test script (see test/scripts/README.md); exit 1 on failure
// --card may repeat; later cards override files of earlier ones. Without --card it uses cards/freibeuter-der-karibik/original
// (cards/ is git-ignored: put or link your own SD-card copies there as cards/GAME/VERSION/;
// YVIO_CARDS sets another folder). --language selects a language of the game's lang.txt
// (e.g. "en" on Freibeuter der Karibik 1.1), as the page's Language choice does; --menu-language
// (script: "menuLanguage") selects one of the card root's lang.txt, the console menu's language.
// --volume (script: "volume") is the console volume 0..255 the OS has saved (default 0: none, the
// apps then set 200); it carries over os_exec reboots.
// --follow-exec (script: "followExec": true) reboots into the app an os_exec names, as the page
// does (e.g. the console menu app.elf starting PIRATES/app.elf); times then run on across reboots.
// --log-calls ADDR[:FMT][=LABEL],... (or @FILE with one such entry per line, # comments) prints a line
// whenever the app executes ADDR, with r0, r1, ... formatted by the letters of FMT (default "s"):
// s C string (UTF-8), d signed int, u unsigned, x hex, f float bits, - skip. E.g. an app's debug-print stubs.

import { performance } from 'node:perf_hooks';
import { vfsFromDirs } from './node-files.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { Machine, AUDIO_RATE } from '../yvio-emulator/machine.js';
import { createCpu } from '../yvio-emulator/cpu.js';
import { toAscii } from '../yvio-emulator/display.js';

const args = process.argv.slice(2);
const opt = { cards: [], app: 'pirates/app.elf', trace: false, quietTime: false, untilWav: false, ms: 10000, wav: null, slice: undefined, display: false, presses: [], files: false, language: null, followExec: false, menuLanguage: null, volume: undefined, logCalls: [] };
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
  else if (a === '--follow-exec') opt.followExec = true;
  else if (a === '--menu-language') opt.menuLanguage = args[++i];
  else if (a === '--volume') opt.volume = Number(args[++i]);
  else if (a === '--log-calls') opt.logCalls.push(...parseLogCalls(args[++i]));
  else if (a === '--press') opt.presses = args[++i].split(',').map(p => { const [at, key, hold = 150] = p.split(':').map(Number); return { at, key, hold }; });
  else if (!a.startsWith('--') && a.endsWith('.json')) opt.script = JSON.parse(readFileSync(a, 'utf8'));
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
/** Parse a --log-calls spec into [{addr, fmt, label}]. */
function parseLogCalls(spec) {
  const items = spec.startsWith('@')
    ? readFileSync(spec.slice(1), 'utf8').split('\n').map(l => l.replace(/#.*/, '').trim()).filter(Boolean)
    : spec.split(',');
  return items.map(it => {
    const m = /^(?:0x)?([0-9a-f]+)(?::([sduxf-]+))?(?:[=\s]+(.*))?$/i.exec(it.trim());
    if (!m) { console.error(`bad --log-calls entry "${it}"`); process.exit(2); }
    return { addr: parseInt(m[1], 16), fmt: m[2] ?? 's', label: m[3] ?? '' };
  });
}
const f32 = new DataView(new ArrayBuffer(4));
/** Format register value v by letter c (see --log-calls). */
function fmtArg(c, v) {
  if (c === 's') return v ? JSON.stringify(Buffer.from(m.cpu.readCString(v, 300), 'latin1').toString('utf8')) : 'NULL';
  if (c === 'd') return String(v | 0);
  if (c === 'u') return String(v >>> 0);
  if (c === 'x') return '0x' + (v >>> 0).toString(16);
  if (c === 'f') { f32.setUint32(0, v >>> 0); return String(+f32.getFloat32(0).toPrecision(7)); }
  return null;
}
const cardsDir = (process.env.YVIO_CARDS ?? new URL('../cards', import.meta.url).pathname).replace(/\/?$/, '/');
const script = opt.script;
if (script) {
  if (!opt.cards.length) for (const c of script.cards ?? ['freibeuter-der-karibik/original']) opt.cards.push(cardsDir + c);
  if (script.app) opt.app = script.app;
  if (script.language) opt.language ??= script.language;
  if (script.followExec) opt.followExec = true;
  if (script.menuLanguage) opt.menuLanguage ??= script.menuLanguage;
  if (script.volume !== undefined) opt.volume ??= script.volume;
  opt.ms = script.timeoutMs ?? 120000;
  opt.files = opt.files || !!script.verbose;
  console.log(`script: ${script.description ?? '(no description)'}`);
}
if (!opt.cards.length) opt.cards.push(cardsDir + 'freibeuter-der-karibik/original');

const t0 = performance.now();
let cpu = await createCpu('unicorn');
const tCpu = performance.now() - t0;
const vfs = vfsFromDirs(...opt.cards);
/** Select `code` in `folder`'s lang.txt ('' = the card root, the console menu's), or exit. */
function selectLanguage(folder, code) {
  if (vfs.setLanguage(folder, code)) return;
  const langs = vfs.languages(folder);
  console.error(`${folder || 'the card root'} has no language "${code}" (lang.txt: ${langs ? langs.languages.map(l => l.code).join(', ') : 'none'})`);
  process.exit(2);
}
if (opt.language) selectLanguage(opt.app.split('/').slice(0, -1).join('/'), opt.language);
if (opt.menuLanguage) selectLanguage('', opt.menuLanguage);
const NOISY = new Set(['os_get_time_ms']);
let wavHit = null;
const recent = [];
const opened = []; // {t, path} of successful fopens
let lastFrame = '';
let m, base = 0; // base: virtual ms of the machines before the last os_exec
const clock = () => base + m.kernel.timeMs;
/** Boot `appPath` (again after an os_exec, keeping the board) and hook up the tracing. */
async function start(appPath, board, volume = opt.volume) {
  m = await Machine.create({
    vfs, appPath, cpu, slice: opt.slice, board, volume,
    log: line => console.log(`[log] ${line}`),
    trace: (t, task, n, text) => {
      const line = `[${t.toFixed(3).padStart(10)} ms] ${task.padEnd(16)} ${text}`;
      recent.push(line); if (recent.length > 40) recent.shift();
      if (opt.trace && !(opt.quietTime && NOISY.has(text.slice(0, text.indexOf('('))))) console.log(line);
    },
  });
  for (const lc of opt.logCalls) {
    m.cpu.hookCode(lc.addr, lc.addr, () => {
      const vals = [...lc.fmt].map((c, i) => fmtArg(c, m.cpu.reg(i))).filter(v => v !== null);
      console.log(`[call @ ${clock().toFixed(0)} ms] ${lc.label || lc.addr.toString(16)}: ${vals.join(' ')}`);
    });
  }
  m.kuma.on.fileOpen = (path, ok) => {
    if (ok) opened.push({ t: clock(), path });
    if (opt.trace || opt.files) console.log(`[file @ ${clock().toFixed(0)} ms] fopen ${path} ${ok ? 'ok' : 'FAILED'}`);
    if (ok && /\.wav$/i.test(path) && !wavHit) wavHit = path;
  };
  m.kuma.on.display = fb => {
    const hex = Buffer.from(fb).toString('hex');
    if (opt.trace) console.log(`[display] ${hex}`);
    if (opt.display && hex !== lastFrame) console.log(`[frame @ ${clock().toFixed(0)} ms]\n${toAscii(fb)}`);
    lastFrame = hex;
  };
  m.onAudio = buf => {
    for (const v of buf) audioPeak = Math.max(audioPeak, Math.abs(v));
    if (opt.wav) pcm.push(buf.slice());
  };
}
const pcm = [];
let audioPeak = 0;
await start(opt.app);

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
  const now = clock();
  if (script) {
    advanceSteps(now);
    if (stepIdx >= steps.length && expectMatched() === expect.length) { result = 'script done'; break; }
  }
  let keys = 0;
  for (const p of opt.presses) if (now >= p.at && now < p.at + p.hold) keys |= 1 << p.key;
  if (keys !== m.kuma.keys) { if (opt.trace || opt.files) console.log(`[keys @ ${now.toFixed(0)} ms] 0x${keys.toString(16)}`); m.kuma.keys = keys; }
  result = m.runFor(10);
  const exec = m.kuma.exitRequest;
  if (result === 'halted' && opt.followExec && exec?.kind === 'exec') {
    console.log(`[exec @ ${clock().toFixed(0)} ms] ${exec.path || 'app.elf'}`);
    base = clock();
    m.cpu.close();
    cpu = await createCpu('unicorn');
    await start(exec.path || 'app.elf', m.kuma.board, m.kuma.volume.saved);
    continue;
  }
  if (result !== 'time') break;
  if (opt.untilWav && wavHit) { result = `first wav: ${wavHit}`; break; }
  if (clock() >= opt.ms) break;
}
const wall = performance.now() - tRun;

console.log('---');
console.log(`result: ${result}${m.halted ? ' — ' + m.halted : ''}`);
if (m.fault || (m.halted && !/^app returned|^os_exec/.test(m.halted))) {
  console.log('last syscalls:\n' + recent.join('\n'));
  for (const t of m.kernel.tasks) console.log(m.dumpTask(t));
}
const vms = clock();
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
  // "expectLanguage": {"FOLDER": "code"}: the language selected in FOLDER/lang.txt at the end ('' = card root)
  const langWrong = Object.entries(script.expectLanguage ?? {}).map(([folder, code]) => {
    const langs = vfs.languages(folder);
    const now = langs?.languages[langs.selected]?.code ?? 'none';
    return now === code ? null : `${folder || 'card root'}/lang.txt selects ${now}, expected ${code}`;
  }).filter(Boolean);
  const volWrong = script.expectVolume !== undefined && m.kuma.volume.saved !== script.expectVolume;
  const ok = got === expect.length && stepIdx >= steps.length && !langWrong.length && !volWrong;
  console.log(`script ${ok ? 'PASSED' : 'FAILED'}: ${got}/${expect.length} expected files, ${stepIdx}/${steps.length} steps` +
    (script.expectLanguage ? `, languages ${langWrong.length ? langWrong.join('; ') : 'as expected'}` : '') +
    (script.expectVolume !== undefined ? `, volume ${m.kuma.volume.saved} (expected ${script.expectVolume})` : ''));
  if (!ok) {
    if (got < expect.length) console.log(`  next expected file: /${expect[got].source}/`);
    console.log('  files opened:\n' + opened.map(f => `    ${f.t.toFixed(0).padStart(7)} ms  ${f.path}`).join('\n'));
  }
  process.exitCode = ok ? 0 : 1;
}
console.log(`console volume: ${m.kuma.volume.saved}`);
console.log(`tasks: ${m.kernel.tasks.map(t => `${t.name}(p${t.prio},${t.state}${t.wait ? ':' + t.wait.kind : ''})`).join(' ')}`);
