// TNKernel 2.x subset as seen by the app: tasks, semaphores, mutexes, data queues, sleep.
// Tasks are saved CPU register contexts. Kernel objects live in JS, keyed by the guest
// address of the app's control block. Time is virtual milliseconds (1 tick = 1 ms in kuma).

import { R, CTX_WORDS } from './cpu.js';

export const TERR = { NO_ERR: 0, WCONTEXT: -2, OVERFLOW: -3, TIMEOUT: -4, WRONG_PARAM: -5, ILUSE: -6, NOEXS: -9 };
export const WAIT_INFINITE = 0xffffffff;
/** Returned by a syscall handler when the calling task blocked. */
export const BLOCK = Symbol('block');

/** Round-robin quantum per priority, as set by kuma (tn_sys_tslice_ticks(prio, 10)). */
const RR_QUANTUM_MS = 10;
const CPSR_SYS = 0x1f; // tasks run in SYS mode, ARM state; IRQ/FIQ bits irrelevant here

let nextTaskId = 1;

export class Task {
  constructor({ name, addr = 0, prio }) {
    this.id = nextTaskId++;
    this.name = name;
    this.addr = addr;           // guest TN_TCB address (0 for emulator-created tasks)
    this.prio = prio;           // lower number = higher priority
    this.ctx = new Uint32Array(CTX_WORDS);
    /** @type {'ready'|'wait'|'dormant'} */
    this.state = 'dormant';
    this.wait = null;           // {obj, kind, ...} while waiting
    this.wakeAt = Infinity;     // virtual ms timeout, Infinity = none
    this.ranMs = 0;             // time used in the current RR quantum
  }
}

export class Kernel {
  /** @param {import('./cpu.js').Cpu} cpu  @param {(msg:string) => void} log */
  constructor(cpu, log = () => {}) {
    this.cpu = cpu;
    this.log = log;
    this.timeMs = 0;
    /** @type {Task[]} */
    this.tasks = [];
    /** @type {Task|null} */
    this.current = null;
    this.needResched = false;
    this.sems = new Map();
    this.mutexes = new Map();
    this.queues = new Map();
  }

  // ---- tasks ----------------------------------------------------------------------------

  /**
   * Create a task that starts at `pc` with r0 = param, sp = stack top, lr = exit trampoline.
   * @returns {Task}
   */
  createTask({ name, addr = 0, prio, pc, sp, param = 0, lr = 0, start = true }) {
    const t = new Task({ name, addr, prio });
    t.ctx[0] = param >>> 0;
    t.ctx[R.SP] = sp >>> 0;
    t.ctx[R.LR] = lr >>> 0;
    t.ctx[R.PC] = pc >>> 0;
    t.ctx[R.CPSR] = CPSR_SYS | ((pc & 1) ? 0x20 : 0);
    t.ctx[R.PC] &= ~1;
    t.state = start ? 'ready' : 'dormant';
    this.tasks.push(t);
    if (start) this.checkPreempt(t);
    return t;
  }

  taskByAddr(addr) { return this.tasks.find(t => t.addr === addr) ?? null; }

  /** Ask the running CPU slice to end soon if `t` should run instead of the current task. */
  checkPreempt(t) {
    if (!this.current || (t.state === 'ready' && t.prio < this.current.prio)) this.needResched = true;
  }

  /**
   * Block the current task (called from a syscall handler). The task resumes at its LR with
   * r0 = the value given to wake(), or TERR.TIMEOUT when the timeout expires.
   * @returns {typeof BLOCK}
   */
  block(wait, timeout) {
    const t = this.current;
    t.state = 'wait';
    t.wait = wait;
    t.wakeAt = timeout === WAIT_INFINITE || timeout === undefined ? Infinity : this.timeMs + timeout;
    this.needResched = true;
    return BLOCK;
  }

  /** Make a waiting task ready, with `r0` as the return value of its blocking call. */
  wake(t, r0 = TERR.NO_ERR) {
    if (t.state !== 'wait') return;
    const q = t.wait?.queue;
    if (q) { const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); }
    t.state = 'ready';
    t.wait = null;
    t.wakeAt = Infinity;
    t.ctx[0] = r0 >>> 0;
    this.checkPreempt(t);
  }

  /** Wake every task whose timeout has passed. */
  expireTimers() {
    for (const t of this.tasks) {
      if (t.state === 'wait' && t.wakeAt <= this.timeMs) {
        const w = t.wait;
        this.wake(t, w?.kind === 'sleep' ? TERR.NO_ERR : TERR.TIMEOUT);
        if (w?.onTimeout) w.onTimeout(t);
      }
    }
  }

  /** Earliest pending timeout, or Infinity. */
  nextTimer() {
    let m = Infinity;
    for (const t of this.tasks) if (t.state === 'wait' && t.wakeAt < m) m = t.wakeAt;
    return m;
  }

  /** Highest-priority ready task; equal priorities rotate when the quantum is used up. */
  pickNext() {
    let best = null;
    for (const t of this.tasks) if (t.state === 'ready' && (!best || t.prio < best.prio)) best = t;
    if (!best) return null;
    const cur = this.current;
    if (cur && cur.state === 'ready' && cur.prio === best.prio) {
      if (cur.ranMs < RR_QUANTUM_MS) return cur;
      cur.ranMs = 0;
      // rotate: move cur behind the other tasks of its priority
      this.tasks.splice(this.tasks.indexOf(cur), 1);
      this.tasks.push(cur);
      for (const t of this.tasks) if (t.state === 'ready' && t.prio === cur.prio) return t;
    }
    return best;
  }

  // ---- syscalls (args are raw u32 values) -------------------------------------------------

  /** Build the syscall handler table for the TNKernel slots. */
  handlers() {
    const k = this;
    const mem = this.cpu;
    return {
      // tasks
      tn_task_create(task, func, prio, stackStart, size, param, option) {
        if (!task || !func || prio < 1 || prio > 30 || !stackStart) return TERR.WRONG_PARAM;
        k.createTask({ name: `task@${task.toString(16)}`, addr: task, prio, pc: func,
          sp: (stackStart + 4) & ~7, param, lr: 0, start: (option & 1) !== 0 });
        k.log(`tn_task_create tcb=0x${task.toString(16)} func=0x${func.toString(16)} prio=${prio} stack=${size}w`);
        return TERR.NO_ERR;
      },
      tn_task_activate(task) {
        const t = k.taskByAddr(task);
        if (!t) return TERR.NOEXS;
        if (t.state !== 'dormant') return TERR.OVERFLOW;
        t.state = 'ready'; k.checkPreempt(t);
        return TERR.NO_ERR;
      },
      tn_task_exit() {
        const t = k.current;
        t.state = 'dormant';
        k.needResched = true;
        k.log(`tn_task_exit ${t.name}`);
        return BLOCK;
      },
      tn_task_sleep(timeout) {
        if (timeout === 0) return TERR.WRONG_PARAM;
        return k.block({ kind: 'sleep' }, timeout);
      },
      tn_task_wakeup(task) {
        const t = k.taskByAddr(task);
        if (!t) return TERR.NOEXS;
        if (t.state === 'wait' && t.wait?.kind === 'sleep') { k.wake(t, TERR.NO_ERR); return TERR.NO_ERR; }
        return TERR.WCONTEXT;
      },
      tn_task_change_priority(task, prio) {
        const t = task ? k.taskByAddr(task) : k.current;
        if (!t) return TERR.NOEXS;
        t.prio = prio || t.prio; k.needResched = true;
        return TERR.NO_ERR;
      },

      // semaphores
      tn_sem_create(sem, start, max) {
        start |= 0; max |= 0;
        if (!sem || max <= 0 || start < 0 || start > max) return TERR.WRONG_PARAM;
        k.sems.set(sem, { count: start, max, queue: [] });
        return TERR.NO_ERR;
      },
      tn_sem_delete(sem) {
        const s = k.sems.get(sem);
        if (!s) return TERR.NOEXS;
        for (const t of [...s.queue]) k.wake(t, TERR.NOEXS);
        k.sems.delete(sem);
        return TERR.NO_ERR;
      },
      tn_sem_signal(sem) {
        const s = k.sems.get(sem);
        if (!s) return TERR.NOEXS;
        if (s.queue.length) { k.wake(s.queue[0], TERR.NO_ERR); return TERR.NO_ERR; }
        if (s.count >= s.max) return TERR.OVERFLOW;
        s.count++;
        return TERR.NO_ERR;
      },
      tn_sem_acquire(sem, timeout) {
        const s = k.sems.get(sem);
        if (!s) return timeout === 0 ? TERR.WRONG_PARAM : TERR.NOEXS;
        if (timeout === 0) return TERR.WRONG_PARAM;
        if (s.count > 0) { s.count--; return TERR.NO_ERR; }
        s.queue.push(k.current);
        return k.block({ kind: 'sem', obj: sem, queue: s.queue }, timeout);
      },
      tn_sem_polling(sem) {
        const s = k.sems.get(sem);
        if (!s) return TERR.NOEXS;
        if (s.count > 0) { s.count--; return TERR.NO_ERR; }
        return TERR.TIMEOUT;
      },

      // mutexes (no priority inheritance/ceiling: single-core cooperative model is enough)
      tn_mutex_create(m) {
        if (!m) return TERR.WRONG_PARAM;
        k.mutexes.set(m, { owner: null, queue: [] });
        return TERR.NO_ERR;
      },
      tn_mutex_delete(m) {
        const x = k.mutexes.get(m);
        if (!x) return TERR.NOEXS;
        for (const t of [...x.queue]) k.wake(t, TERR.NOEXS);
        k.mutexes.delete(m);
        return TERR.NO_ERR;
      },
      tn_mutex_lock(m, timeout) {
        const x = k.mutexes.get(m);
        if (!x) return TERR.NOEXS;
        if (timeout === 0) return TERR.WRONG_PARAM;
        if (!x.owner) { x.owner = k.current; return TERR.NO_ERR; }
        if (x.owner === k.current) return TERR.ILUSE;
        x.queue.push(k.current);
        return k.block({ kind: 'mutex', obj: m, queue: x.queue }, timeout);
      },
      tn_mutex_lock_polling(m) {
        const x = k.mutexes.get(m);
        if (!x) return TERR.NOEXS;
        if (!x.owner) { x.owner = k.current; return TERR.NO_ERR; }
        return x.owner === k.current ? TERR.ILUSE : TERR.TIMEOUT;
      },
      tn_mutex_unlock(m) {
        const x = k.mutexes.get(m);
        if (!x) return TERR.NOEXS;
        if (x.owner !== k.current) return TERR.ILUSE;
        x.owner = x.queue[0] ?? null;
        if (x.owner) k.wake(x.owner, TERR.NO_ERR);
        return TERR.NO_ERR;
      },

      // data queues: entries are void* values
      tn_queue_create(q, fifo, n) {
        if (!q) return TERR.WRONG_PARAM;
        k.queues.set(q, { items: [], size: n | 0, recv: [], send: [] });
        return TERR.NO_ERR;
      },
      tn_queue_delete(q) {
        const x = k.queues.get(q);
        if (!x) return TERR.NOEXS;
        for (const t of [...x.recv, ...x.send]) k.wake(t, TERR.NOEXS);
        k.queues.delete(q);
        return TERR.NO_ERR;
      },
      tn_queue_send(q, data, timeout) { return queueSend(q, data, timeout, true); },
      tn_queue_send_polling(q, data) { return queueSend(q, data, 0, false); },
      tn_queue_isend_polling(q, data) { return queueSend(q, data, 0, false); },
      tn_queue_receive(q, pdata, timeout) { return queueRecv(q, pdata, timeout, true); },
      tn_queue_receive_polling(q, pdata) { return queueRecv(q, pdata, 0, false); },
      tn_queue_ireceive(q, pdata) { return queueRecv(q, pdata, 0, false); },
    };

    function queueSend(q, data, timeout, canBlock) {
      const x = k.queues.get(q);
      if (!x) return TERR.NOEXS;
      const r = x.recv.shift();
      if (r) { mem.write32(r.wait.pdata, data); r.wait.queue = null; k.wake(r, TERR.NO_ERR); return TERR.NO_ERR; }
      if (x.items.length < x.size) { x.items.push(data); return TERR.NO_ERR; }
      if (!canBlock) return TERR.TIMEOUT;
      if (timeout === 0) return TERR.WRONG_PARAM;
      x.send.push(k.current);
      return k.block({ kind: 'qsend', obj: q, queue: x.send, data }, timeout);
    }

    function queueRecv(q, pdata, timeout, canBlock) {
      const x = k.queues.get(q);
      if (!x) return TERR.NOEXS;
      if (x.items.length) {
        mem.write32(pdata, x.items.shift());
        const s = x.send.shift();
        if (s) { x.items.push(s.wait.data); s.wait.queue = null; k.wake(s, TERR.NO_ERR); }
        return TERR.NO_ERR;
      }
      const s = x.send.shift();
      if (s) { mem.write32(pdata, s.wait.data); s.wait.queue = null; k.wake(s, TERR.NO_ERR); return TERR.NO_ERR; }
      if (!canBlock) return TERR.TIMEOUT;
      if (timeout === 0) return TERR.WRONG_PARAM;
      x.recv.push(k.current);
      return k.block({ kind: 'qrecv', obj: q, queue: x.recv, pdata }, timeout);
    }
  }
}
