// The emulated console: memory map, app loading, syscall trap, scheduler loop, virtual clock.
// DOM-free so it runs in Node tests, a Web Worker or the page itself.

import { createCpu, R } from './cpu.js';
import { loadElf } from './elf.js';
import { Kernel, BLOCK } from './tnkernel.js';
import { Kuma } from './kuma.js';
import { SYSCALLS } from './syscalls.js';

export const MEM = {
  LOW: 0x0, LOW_SIZE: 0x3000,                 // vectors + syscall table page (0x1000) + sentinels
  FLASH: 0x3000, FLASH_END: 0x56000,          // app flash
  RAM: 0x40000000, RAM_SIZE: 0x20000,         // app RAM 0x40000000-0x40003fff, rest emulator-owned
  OS_RAM: 0x40004000,                         // handles, buffers, argv
  MAIN_STACK_TOP: 0x40020000,                 // app main task stack (top of mapped RAM)
  AUDIO_STACK_TOP: 0x40016000,                // OS audio task stack (runs the app's fill callback)
  AUDIO_BUF: 0x40015000,                      // two 0x100-byte PCM buffers
};
export const SYSCALL_BASE = 0x1000;
export const SYSCALL_END = SYSCALL_BASE + 4 * SYSCALLS.length;
/** Return addresses that end emulator-driven calls; they sit in the hooked low page. */
export const SENTINEL = { APP_EXIT: 0x1800, AUDIO_RET: 0x1804 };

const ARM_BX_LR = 0xe12fff1e, ARM_B_SELF = 0xeafffffe;
const APP_PRIO = 14;          // kuma runs the app in a priority-14 task
/** Nominal CPU speed for virtual time accounting (ARM7 @ ~60 MHz from flash). */
export const NOMINAL_IPS = 30e6;
/**
 * Instructions per emu_start call. 0 = unlimited: a task runs until a syscall blocks it or
 * preempts it (timers are checked after every syscall). That is about twice as fast, because
 * Unicorn's instruction counting adds a per-instruction hook, but code that loops without any
 * syscall would never yield. The app does syscalls constantly, so 0 is the default; a counted
 * slice (e.g. 20000 = ~0.67 ms) also charges virtual time for the instructions run.
 */
export const DEFAULT_SLICE = 0;
const SYSCALL_COST_MS = 0.002;
/** OS audio task: priority 2, calls fmt.callback(&fmt[6], buf, 0x100) per buffer (OS.elf 0x5fbdc). */
const AUDIO_PRIO = 2;
export const AUDIO_RATE = 22050;
const AUDIO_BUF_BYTES = 0x100;
export const AUDIO_BUF_SAMPLES = AUDIO_BUF_BYTES / 2; // signed 16-bit mono
const AUDIO_PERIOD_MS = AUDIO_BUF_SAMPLES / AUDIO_RATE * 1000;

/** Format a syscall for traces, using the prototype to show strings. */
export function formatCall(cpu, n, args, ret) {
  const info = SYSCALLS[n];
  const types = (info?.proto.match(/\((.*)\)/)?.[1] ?? '').split(',');
  const shown = args.map((a, i) => {
    if (/char\s*\*/.test(types[i] ?? '') && !/\*\*/.test(types[i]) && a) {
      try { return JSON.stringify(cpu.readCString(a, 64)); } catch { /* fall through */ }
    }
    return a < 10 ? String(a) : '0x' + a.toString(16);
  });
  const r = ret === BLOCK ? ' -> (blocks)' : ret === undefined ? '' : ` = ${(ret | 0) < 0 && (ret | 0) > -1000 ? ret | 0 : '0x' + (ret >>> 0).toString(16)}`;
  return `${info?.name ?? 'sys' + n}(${shown.join(', ')})${r}`;
}

export class Machine {
  /**
   * @param {object} o
   * @param {import('./files.js').Vfs} o.vfs
   * @param {string} [o.appPath]
   * @param {import('./cpu.js').Cpu} [o.cpu]
   * @param {(line:string) => void} [o.log]
   * @param {(t:number, task:string, n:number, text:string) => void} [o.trace]  per-syscall trace
   * @param {number} [o.slice]  instructions per emu_start (see DEFAULT_SLICE)
   * @param {import('./board.js').Board} [o.board]  virtual board; pass the old one when rebooting
   */
  static async create({ vfs, appPath = 'pirates/app.elf', cpu, log = () => {}, trace = null, slice = DEFAULT_SLICE, board }) {
    cpu ??= await createCpu('unicorn');
    const m = new Machine(cpu, vfs, appPath, log, trace, board);
    m.slice = slice;
    m.load();
    return m;
  }

  constructor(cpu, vfs, appPath, log, trace, board) {
    this.cpu = cpu;
    this.vfs = vfs;
    this.appPath = appPath;
    this.log = log;
    this.trace = trace;
    this.kernel = new Kernel(cpu, log);
    this.stopped = false;     // set when a hook ended the current slice
    this.halted = null;       // reason string once the app can't continue
    this.instructions = 0;    // instructions in completed slices (lower bound)
    this.syscalls = 0;
    this.slice = DEFAULT_SLICE;

    cpu.mapMemory(MEM.LOW, MEM.LOW_SIZE);
    cpu.mapMemory(MEM.FLASH, MEM.FLASH_END - MEM.FLASH);
    cpu.mapMemory(MEM.RAM, MEM.RAM_SIZE);
    for (let a = SYSCALL_BASE; a < SYSCALL_END; a += 4) cpu.write32(a, ARM_BX_LR);
    for (const a of Object.values(SENTINEL)) cpu.write32(a, ARM_B_SELF);

    this.kuma = new Kuma({ cpu, kernel: this.kernel, vfs, osRam: MEM.OS_RAM, appPath, board });
    this.kuma.on.log = log;
    this.kuma.on.audioOpen = () => this.startAudio();
    this.audioTask = null;
    this.audioBufIdx = 0;
    this.audioBuffers = 0;
    /** called with each filled PCM buffer (Int16Array of AUDIO_BUF_SAMPLES, a copy) */
    this.onAudio = (/** @type {Int16Array} */ _pcm) => {};
    cpu.hookCode(SYSCALL_BASE, 0x1fff, addr => {
      // An exception must not unwind through the wasm engine: turn it into a halt.
      try { this.onTrap(addr); } catch (e) {
        this.halted = `emulator error in syscall at 0x${addr.toString(16)}: ${e.stack ?? e}`;
        this.endSlice(this.kernel.current, addr);
      }
    });
  }

  load() {
    const elfBytes = this.vfs.get(this.appPath);
    if (!elfBytes) throw new Error(`${this.appPath} not found on the virtual SD card`);
    const elf = loadElf(this.cpu, elfBytes, { flashLo: MEM.FLASH, flashHi: MEM.FLASH_END });
    this.entry = elf.entry;
    this.mainTask = this.kernel.createTask({
      name: 'main', prio: APP_PRIO, pc: elf.entry, sp: MEM.MAIN_STACK_TOP, lr: SENTINEL.APP_EXIT,
    });
    this.log(`loaded ${this.appPath}: entry 0x${elf.entry.toString(16)}, ${elf.segments.length} PT_LOAD segments`);
  }

  /** Code hook for the syscall page and the sentinels. */
  onTrap(addr) {
    const cpu = this.cpu, k = this.kernel, task = k.current;
    if (addr >= SYSCALL_END) {
      if (addr === SENTINEL.AUDIO_RET && task === this.audioTask) {
        this.audioDone(task);
        return;
      }
      if (addr === SENTINEL.APP_EXIT) {
        this.halted = `app returned ${cpu.reg(0) | 0}`;
        task.state = 'dormant';
      } else {
        this.halted = `unexpected jump to 0x${addr.toString(16)}`;
      }
      this.endSlice(task, addr);
      return;
    }
    const n = (addr - SYSCALL_BASE) >> 2;
    const lr = cpu.reg(R.LR);
    this.syscalls++;
    k.timeMs += SYSCALL_COST_MS;
    task.ranMs += SYSCALL_COST_MS;
    const { value, args } = this.kuma.call(n);
    if (this.trace) this.trace(k.timeMs, task.name, n, formatCall(cpu, n, args, value));
    if (value === BLOCK) {
      this.endSlice(task, lr);
      return;
    }
    if (typeof value === 'number') cpu.setReg(0, value);
    cpu.setReg(R.PC, lr);
    // Preempt at syscall boundaries when a timer (e.g. the audio task's next buffer) is due.
    if (k.needResched || this.kuma.exitRequest || k.nextTimer() <= k.timeMs) this.endSlice(task, lr);
  }

  // ---- audio --------------------------------------------------------------------------

  /** Create the OS audio task after audio_open; its first buffer is due one period later. */
  startAudio() {
    const t = this.kernel.createTask({ name: 'audio', prio: AUDIO_PRIO, pc: 0, sp: MEM.AUDIO_STACK_TOP, start: false });
    t.needsCall = true;
    this.audioTask = t;
    this.audioDue = this.kernel.timeMs + AUDIO_PERIOD_MS;
    this.audioSleep(t);
  }

  audioSleep(t) {
    t.state = 'wait';
    t.wait = { kind: 'sleep' };
    t.wakeAt = this.audioDue;
  }

  /** Set up the audio task's registers for one callback invocation. */
  audioCall(t) {
    const a = this.kuma.audio;
    const buf = MEM.AUDIO_BUF + this.audioBufIdx * AUDIO_BUF_BYTES;
    t.ctx.fill(0);
    t.ctx[0] = a.userPtr; t.ctx[1] = buf; t.ctx[2] = AUDIO_BUF_BYTES;
    t.ctx[R.SP] = MEM.AUDIO_STACK_TOP; t.ctx[R.LR] = SENTINEL.AUDIO_RET; t.ctx[R.PC] = a.callback & ~1;
    t.ctx[R.CPSR] = 0x1f | ((a.callback & 1) ? 0x20 : 0);
    t.needsCall = false;
  }

  /** The callback returned: hand the buffer out and sleep until the next one is due. */
  audioDone(t) {
    const buf = MEM.AUDIO_BUF + this.audioBufIdx * AUDIO_BUF_BYTES;
    const bytes = this.cpu.readBytes(buf, AUDIO_BUF_BYTES);
    this.audioBufIdx ^= 1;
    this.audioBuffers++;
    this.onAudio(new Int16Array(bytes.buffer, 0, AUDIO_BUF_SAMPLES));
    // Fixed schedule; if emulation fell far behind, don't try to catch up a backlog.
    this.audioDue = Math.max(this.audioDue + AUDIO_PERIOD_MS, this.kernel.timeMs - 4 * AUDIO_PERIOD_MS);
    t.needsCall = true;
    this.audioSleep(t);
    this.kernel.needResched = true;
    this.endSlice(t, 0);
  }

  /** Save the running task with PC = resumePc and stop the CPU. */
  endSlice(task, resumePc) {
    this.cpu.saveContext(task.ctx);
    task.ctx[R.PC] = resumePc;
    this.stopped = true;
    this.cpu.stop();
  }

  /**
   * Run until `ms` of virtual time have passed, the app halts, or every task is idle forever.
   * @returns {'time'|'idle'|'halted'}
   */
  runFor(ms) {
    const k = this.kernel, cpu = this.cpu;
    const target = k.timeMs + ms;
    while (!this.halted) {
      if (this.kuma.exitRequest) {
        const e = this.kuma.exitRequest;
        this.halted = e.kind === 'exec' ? `os_exec(${JSON.stringify(e.path)}, ${JSON.stringify(e.arg)})` : e.kind;
        break;
      }
      k.expireTimers();
      if (k.timeMs >= target) return 'time';
      const t = k.pickNext();
      if (!t) {
        const nt = k.nextTimer();
        if (nt === Infinity) return 'idle';
        k.timeMs = Math.min(nt, target);
        continue;
      }
      if (t.needsCall) this.audioCall(t);
      if (k.current !== t) t.ranMs = 0;
      k.current = t;
      k.needResched = false;
      this.stopped = false;
      cpu.restoreContext(t.ctx);
      try {
        cpu.run(this.slice);
      } catch (e) {
        this.halted = `${e.message} in task ${t.name}`;
        this.fault = e;
        break;
      }
      if (!this.stopped) {
        cpu.saveContext(t.ctx);
        const dt = this.slice / NOMINAL_IPS * 1000;
        k.timeMs += dt;
        t.ranMs += dt;
        this.instructions += this.slice;
      }
    }
    return 'halted';
  }

  /** Register dump of a task (or the CPU) for error reports. */
  dumpTask(t = this.kernel.current) {
    const c = t.ctx, h = v => v.toString(16).padStart(8, '0');
    const regs = [...Array(16).keys()].map(i => `${['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11','r12','sp','lr','pc'][i]}=${h(c[i])}`);
    return `${t.name} [${t.state}] ${regs.join(' ')} cpsr=${h(c[R.CPSR])}`;
  }
}
