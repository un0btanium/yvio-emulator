// Fake "kuma" OS: implements the syscall slots at 0x1000 + 4n (list in syscalls.js) in JS.
// Semantics follow the OS.elf implementations (sysNN_* functions in the reverse-engineering notes, not part of this repo).

import { SYSCALLS } from './syscalls.js';
import { BLOCK, TERR } from './tnkernel.js';
import { R } from './cpu.js';
import { Board } from './board.js';

const EINVAL = 0xffffffea | 0; // -22, used by the file/audio calls
const FILE_SLOTS = 16, FILE_SIZE = 0x50, DIR_SLOTS = 4, DIR_SIZE = 0x34;
const AUDIO_MAGIC = 0x5622;
const RAND_A = 0x41c64e6d, RAND_C = 0x3039;
// The menu and the games change the volume by ±4 of 255 per Vol −/+ key press
// (audio_set_volume(0, audio_get_param(0) ± 4)). On the page's linear volume that is about 1.5 %
// and can't be heard, so the emulator's OS widens such a step to ±16 (about 6 %).
const VOLUME_APP_STEP = 4, VOLUME_KEY_STEP = 16;
// RFID calls take time on the real console, and the game polls the board in loops without
// sleeping (e.g. while a "wrong goods field" prompt plays). Instant calls would make such a loop
// burn host CPU for almost no virtual time, so the emulator falls behind and the audio stutters.
// OS.elf sys34_rfid_select_antenna sleeps 1 tick (1 ms); a 1-slot ISO 15693 inventory is about
// 2 ms of request and timeout, plus about 4 ms for each tag's 12-byte reply at 26 kbit/s.
const RFID_SELECT_MS = 1, RFID_INVENTORY_MS = 2, RFID_TAG_MS = 4;

/** Convert a host file name to the FAT 8.3 form the OS returns from readdir ("NAME.EXT"). */
function shortName(name) {
  const up = name.toUpperCase();
  const dot = up.lastIndexOf('.');
  const base = (dot > 0 ? up.slice(0, dot) : up).replace(/[ .]/g, '');
  const ext = dot > 0 ? up.slice(dot + 1) : '';
  return base.slice(0, 8) + (ext ? '.' + ext.slice(0, 3) : '');
}

export class Kuma {
  /**
   * @param {object} o
   * @param {import('./cpu.js').Cpu} o.cpu
   * @param {import('./tnkernel.js').Kernel} o.kernel
   * @param {import('./files.js').Vfs} o.vfs
   * @param {number} o.osRam  base of the emulator-owned RAM area for handles and buffers
   * @param {string} o.appPath  path of the running app, e.g. "pirates/app.elf" (becomes argv[0])
   * @param {Board} [o.board]  the virtual board (kept across app restarts)
   * @param {number} [o.volume]  the saved volume 0..255 (the OS keeps it across resets; 0 = none,
   *   then the apps set 200 at their first sound)
   */
  constructor({ cpu, kernel, vfs, osRam, appPath, board = new Board(), volume = 0 }) {
    this.cpu = cpu;
    this.kernel = kernel;
    this.vfs = vfs;
    this.appPath = appPath;
    this.board = board;
    this.keys = 0;                   // os_get_keys bitmask
    this.display = new Uint8Array(24);
    this.randState = 0;
    this.audio = null;               // {fmt:number[], callback, userPtr} after audio_open
    // OS.elf sys40/sys39: left/right volume 0..255, the channel 3 value, and the saved volume
    // (L + R) / 2 that audio_get_param(0) returns
    this.volume = { left: volume, right: volume, ch3: 0, saved: volume };
    this.exitRequest = null;         // {kind, path, arg} when the app restarts or execs
    /** event hooks set by the machine/UI */
    this.on = {
      display: (/** @type {Uint8Array} */ _fb) => {},
      fileOpen: (/** @type {string} */ _path, /** @type {boolean} */ _ok) => {},
      fileWrite: (/** @type {string} */ _path, /** @type {Uint8Array} */ _data) => {},
      audioOpen: () => {},
      volume: (/** @type {number} */ _saved) => {},
      exit: () => {},
      log: (/** @type {string} */ _msg) => {},
    };
    /** @type {Map<number, {path:string, data:Uint8Array, pos:number, write:boolean, dirty:boolean}>} */
    this.files = new Map();
    /** @type {Map<number, {entries:{name:string, isDir:boolean, size:number}[], pos:number}>} */
    this.dirs = new Map();
    this.unimplemented = new Set();

    // OS RAM layout
    let p = osRam;
    const alloc = n => { const a = p; p += (n + 7) & ~7; return a; };
    this.fileBase = alloc(FILE_SLOTS * FILE_SIZE);
    this.dirBase = alloc(DIR_SLOTS * DIR_SIZE);
    this.dirent = alloc(0x20);
    this.fmtCopy = alloc(0x1c);
    this.argcAddr = alloc(4);
    this.argvAddr = alloc(16);
    this.argStr = alloc(64);
    this.heapEnd = p;
    // argv[0] = app path (the framework derives its data folder "pirates/" from it)
    cpu.write32(this.argcAddr, 1);
    cpu.writeBytes(this.argStr, new TextEncoder().encode(appPath + '\0'));
    cpu.write32(this.argvAddr, this.argStr);
    cpu.write32(this.argvAddr + 4, 0);

    this.table = this.buildTable();
  }

  /** Return a syscall handler table indexed by slot. */
  buildTable() {
    const cpu = this.cpu, k = this;
    const tn = this.kernel.handlers();
    /** @type {Record<string, (...a:number[]) => number|void|typeof BLOCK>} */
    const os = {
      os_restart_app() { return k.exit('restart'); },
      os_restart_app_cold() { return k.exit('restart'); },
      os_exec(path, argp) {
        const p = path ? cpu.readCString(path) : 'app.elf';
        const a = argp && cpu.read32(argp) ? cpu.readCString(cpu.read32(argp)) : '';
        return k.exit('exec', p, a);
      },

      os_fopen(path, mode) {
        const p = cpu.readCString(path), m = String.fromCharCode(cpu.read8(mode));
        const slot = [...Array(FILE_SLOTS).keys()].find(i => !k.files.has(k.fileBase + i * FILE_SIZE));
        let h = 0;
        if (slot !== undefined) {
          const data = k.vfs.get(p);
          if (m === 'r' && data) {
            h = k.fileBase + slot * FILE_SIZE;
            k.files.set(h, { path: p, data, pos: 0, write: false, dirty: false });
          } else if (m === 'w' || m === 'a') {
            h = k.fileBase + slot * FILE_SIZE;
            const init = m === 'a' && data ? data : new Uint8Array(0);
            k.files.set(h, { path: p, data: init, pos: init.length, write: true, dirty: m === 'w' });
          }
        }
        k.on.fileOpen(p, h !== 0);
        return h;
      },
      os_fclose(h) {
        const f = k.files.get(h);
        if (!f) return -1;
        if (f.dirty) { k.vfs.add(f.path, f.data); k.on.fileWrite(f.path, f.data); }
        k.files.delete(h);
        return 0;
      },
      os_fread(buf, size, count, h) {
        const f = k.files.get(h);
        if (!f) return -1;
        if (!size) return 0;
        const n = Math.max(0, Math.min(size * count, f.data.length - f.pos));
        if (n) cpu.writeBytes(buf, f.data.subarray(f.pos, f.pos + n));
        f.pos += n;
        return Math.floor(n / size);
      },
      os_fwrite(buf, size, count, h) {
        const f = k.files.get(h);
        if (!f || !f.write) return -1;
        if (!size) return 0;
        const src = cpu.readBytes(buf, size * count);
        const end = f.pos + src.length;
        if (end > f.data.length) { const d = new Uint8Array(end); d.set(f.data); f.data = d; }
        f.data.set(src, f.pos);
        f.pos = end;
        f.dirty = true;
        return count;
      },
      os_fseek(h, off, whence) {
        const f = k.files.get(h);
        if ((off | 0) < 0 || whence !== 0) return EINVAL;
        if (!f || off > f.data.length) return -5;
        f.pos = off;
        return 0;
      },
      os_opendir(path) {
        const p = cpu.readCString(path);
        const slot = [...Array(DIR_SLOTS).keys()].find(i => !k.dirs.has(k.dirBase + i * DIR_SIZE));
        if (slot === undefined || !k.vfs.isDir(p)) return 0;
        const h = k.dirBase + slot * DIR_SIZE;
        k.dirs.set(h, { entries: k.vfs.list(p), pos: 0 });
        return h;
      },
      os_readdir(h) {
        const d = k.dirs.get(h);
        if (!d || d.pos >= d.entries.length) return 0;
        const e = d.entries[d.pos++];
        const name = new Uint8Array(16);
        name.set(new TextEncoder().encode(shortName(e.name)).subarray(0, 12));
        cpu.writeBytes(k.dirent, name);
        cpu.write32(k.dirent + 0x10, e.size);
        return k.dirent;
      },
      os_closedir(h) { k.dirs.delete(h); return 0; },
      os_stub_m1_18() { return -1; },
      os_stub_m1_19() { return -1; },
      os_fs_sync() { return 0; },

      os_get_time_ms() { return Math.floor(k.kernel.timeMs); },
      os_get_keys(p) { if (!p) return EINVAL; cpu.write32(p, k.keys); return 0; },
      os_display_get(p) { cpu.writeBytes(p, k.display); },
      os_display_set(p) { k.display = cpu.readBytes(p, 24); k.on.display(k.display); },
      os_rand() { k.randState = (Math.imul(k.randState, RAND_A) + RAND_C) >>> 0; return k.randState & 0x7fffffff; },
      os_srand(seed) { k.randState = seed >>> 0; },
      os_stub0_27() { return 0; },
      os_get_args(pa, pb) {
        if (!pa || !pb) return EINVAL;
        cpu.write32(pa, cpu.read32(k.argcAddr));
        cpu.write32(pb, k.argvAddr);
        return 0;
      },
      os_get_version() { return 0x00020000; },

      // RFID: the virtual board (board.js)
      rfid_init() { return 0; },
      rfid_close() {},
      rfid_select_antenna(n) {
        const r = k.board.selectAntenna(n | 0);
        return r < 0 ? r : k.busy(RFID_SELECT_MS, r);
      },
      rfid_inventory(tags, max, flags, px) {
        const n = k.board.inventory(cpu, tags, max, flags, px);
        return k.busy(RFID_INVENTORY_MS + RFID_TAG_MS * Math.max(n, 0), n);
      },
      rfid_read_block(dest, tag, block) { return k.board.readBlock(cpu, dest, tag, block & 0xff); },
      rfid_write_block(tag, src, block, len) { return k.board.writeBlock(cpu, tag, src, block & 0xff, len); },
      rfid_uid_compare(a, b) { return Board.uidCompare(cpu, a, b); },
      os_nop2() {}, os_nop5() {}, os_nop36() {},

      audio_open(fmt) {
        if (!fmt) return EINVAL;
        const w = [...Array(7).keys()].map(i => cpu.read32(fmt + 4 * i));
        if (!w[5] || (w[2] | 0) < 1) return EINVAL;
        if (w[0] !== AUDIO_MAGIC || w[1] !== 3 || w[2] !== 1 || w[3] - 3 >= 2 || w[4] !== 0x100) return -93;
        if (k.audio) return -16;
        cpu.writeBytes(k.fmtCopy, cpu.readBytes(fmt, 0x1c));
        k.audio = { fmt: w, callback: w[5], userPtr: k.fmtCopy + 0x18 };
        k.on.log(`audio_open rate=${w[0]} cb=0x${w[5].toString(16)} buf=0x${w[4].toString(16)}`);
        k.on.audioOpen();
        return 0;
      },
      audio_wait_or_stop() { return 0; },
      audio_get_param(which) {
        const vol = k.volume;
        return [vol.saved, vol.left, vol.right, vol.ch3][which] ?? EINVAL;
      },
      // 0 = both channels, 1 = left, 2 = right, 3 = amplifier setting, 4 = on/off (ignored here)
      audio_set_volume(ch, v) {
        const vol = k.volume;
        v |= 0;
        if (ch === 0 && Math.abs(v - vol.saved) === VOLUME_APP_STEP) v = vol.saved + Math.sign(v - vol.saved) * VOLUME_KEY_STEP;
        v = Math.max(0, Math.min(255, v));
        if (ch === 0 || ch === 1) vol.left = v;
        if (ch === 0 || ch === 2) vol.right = v;
        if (ch === 3) vol.ch3 = v;
        if (ch > 4) return EINVAL;
        const saved = (vol.left + vol.right) >> 1;
        if (saved !== vol.saved) { vol.saved = saved; k.on.volume(saved); }
        return v;
      },
    };
    const all = { ...os, ...tn };
    return SYSCALLS.map(s => all[s.name] ?? null);
  }

  /** Block the calling task for `ms` of virtual time (a busy device), then return `r0`. */
  busy(ms, r0) {
    return this.kernel.block({ kind: 'busy', onTimeout: t => { t.ctx[0] = r0 >>> 0; } }, ms);
  }

  /** Set both channels and the saved volume from outside (the page's volume slider), no hook. */
  setVolume(v) {
    v = Math.max(0, Math.min(255, v | 0));
    Object.assign(this.volume, { left: v, right: v, saved: v });
  }

  exit(kind, path = '', arg = '') {
    this.exitRequest = { kind, path, arg };
    this.kernel.current.state = 'dormant';
    this.kernel.needResched = true;
    this.on.exit();
    return BLOCK;
  }

  /**
   * Dispatch syscall slot n with the arguments of the current CPU state.
   * @returns {{value:number|undefined|typeof BLOCK, args:number[]}}
   */
  call(n) {
    const info = SYSCALLS[n];
    const fn = this.table[n];
    const cpu = this.cpu;
    const args = [];
    for (let i = 0; i < (info?.argc ?? 0); i++)
      args.push(i < 4 ? cpu.reg(i) : cpu.read32(cpu.reg(R.SP) + 4 * (i - 4)));
    if (!fn) {
      if (!this.unimplemented.has(n)) {
        this.unimplemented.add(n);
        this.on.log(`unimplemented syscall ${n} ${info?.name ?? '?'}(${args.map(a => '0x' + a.toString(16)).join(', ')})`);
      }
      return { value: TERR.NO_ERR, args };
    }
    return { value: fn(...args), args };
  }
}
