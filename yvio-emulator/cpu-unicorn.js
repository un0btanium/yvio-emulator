// CPU backend on Unicorn.js v2.1.4 (vendor/unicorn/unicorn_arm.js, GPL-2.0).
// Guest memory is allocated in the wasm heap and mapped with uc_mem_map_ptr, so reads and
// writes from JS go straight to a DataView, without a uc_mem_read call per access.
// Caveat: writes through this path bypass QEMU's translation-block invalidation, so code
// must be in place before it first runs (true here: no self-modifying code).

import { R, CTX_WORDS } from './cpu.js';

const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;

/** @type {Promise<{M:any, memory:WebAssembly.Memory}>|null} */
let modulePromise = null;

/** Load the Unicorn.js module once and capture its wasm memory. */
function loadModule(url) {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    let factory;
    if (IS_NODE) {
      const { createRequire } = await import('node:module');
      const { fileURLToPath } = await import('node:url');
      factory = createRequire(import.meta.url)(fileURLToPath(url));
    } else {
      // A UMD script, not an ES module: evaluate it and take the global it defines.
      const text = await (await fetch(url)).text();
      factory = new Function(`${text}\n;return MUnicorn;`)();
    }
    // The module doesn't export its heap; grab the instance while it is created.
    let instance = null;
    const orig = WebAssembly.instantiate;
    WebAssembly.instantiate = async (...args) => {
      const r = await orig.apply(WebAssembly, args);
      instance = r.instance ?? r;
      return r;
    };
    let M;
    try { M = await factory(); } finally { WebAssembly.instantiate = orig; }
    const memory = instance && Object.values(instance.exports).find(v => v instanceof WebAssembly.Memory);
    if (!memory) throw new Error('Unicorn.js: could not find the wasm memory export');
    return { M, memory };
  })();
  return modulePromise;
}

/**
 * @param {{url?: string|URL}} [opts]
 * @returns {Promise<import('./cpu.js').Cpu>}
 */
export async function createUnicornCpu(opts = {}) {
  const url = opts.url ?? new URL('../vendor/unicorn/unicorn_arm.js', import.meta.url);
  const { M, memory } = await loadModule(url);
  const uc = new M.Unicorn(M.ARCH_ARM, M.MODE_ARM);
  const handle = M.getValue(uc.handle_ptr, '*');

  // Interface register index -> Unicorn register id.
  const REG_IDS = [66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78,
    M.ARM_REG_SP, M.ARM_REG_LR, M.ARM_REG_PC, M.ARM_REG_CPSR];

  // Scratch heap areas for batch register access: ids[], ptrs[], values[].
  const scratch = M._malloc(CTX_WORDS * 12);
  const idsPtr = scratch, ptrsPtr = scratch + CTX_WORDS * 4, valsPtr = scratch + CTX_WORDS * 8;
  // Context order puts CPSR first so a restore switches mode before writing banked SP/LR.
  const CTX_ORDER = [16, ...Array.from({ length: 16 }, (_, i) => i)];
  const BATCH_IDS = CTX_ORDER.map(i => REG_IDS[i]);

  /** @type {{base:number, size:number, ptr:number, raw:number}[]} */
  const regions = [];
  let buf = null, dv = null, u8 = null;
  function views() {
    if (memory.buffer !== buf) {
      buf = memory.buffer; dv = new DataView(buf); u8 = new Uint8Array(buf);
      const ids = new Int32Array(buf, idsPtr, CTX_WORDS), ptrs = new Uint32Array(buf, ptrsPtr, CTX_WORDS);
      for (let i = 0; i < CTX_WORDS; i++) { ids[i] = BATCH_IDS[i]; ptrs[i] = valsPtr + 4 * i; }
    }
  }
  views();

  /** Host heap offset for a guest address range; throws if unmapped. */
  function host(addr, len) {
    addr >>>= 0;
    for (const r of regions) {
      const off = addr - r.base;
      if (off >= 0 && off + len <= r.size) { views(); return r.ptr + off; }
    }
    throw new Error(`guest access to unmapped 0x${addr.toString(16)} (+${len})`);
  }

  let invalidFn = null, lastInvalid = null;
  const kinds = { [M.MEM_READ_UNMAPPED]: 'read-unmapped', [M.MEM_WRITE_UNMAPPED]: 'write-unmapped',
    [M.MEM_FETCH_UNMAPPED]: 'fetch-unmapped', [M.MEM_READ_PROT]: 'read-prot',
    [M.MEM_WRITE_PROT]: 'write-prot', [M.MEM_FETCH_PROT]: 'fetch-prot' };
  uc.hook_add(M.HOOK_MEM_INVALID, (_h, type, addr, size) => {
    lastInvalid = { kind: kinds[type] ?? `mem-${type}`, addr: Number(addr) >>> 0, size };
    return false;
  }, {}, 1, 0);

  /** @type {import('./cpu.js').Cpu} */
  const cpu = {
    name: 'unicorn-2.1.4',
    mapMemory(addr, size) {
      const raw = M._malloc(size + 0xfff);
      const ptr = (raw + 0xfff) & ~0xfff;
      views();
      u8.fill(0, ptr, ptr + size);
      const ret = M._uc_mem_map_ptr(handle, BigInt(addr), BigInt(size), M.PROT_ALL, ptr);
      if (ret !== 0) throw new Error(`uc_mem_map_ptr(0x${addr.toString(16)}) failed: ${M.strerror(ret)}`);
      regions.push({ base: addr >>> 0, size, ptr, raw });
    },
    read8: a => (views(), u8[host(a, 1)]),
    read16: a => { const p = host(a, 2); return dv.getUint16(p, true); },
    read32: a => { const p = host(a, 4); return dv.getUint32(p, true); },
    write8: (a, v) => { u8[host(a, 1)] = v; },
    write16: (a, v) => { const p = host(a, 2); dv.setUint16(p, v, true); },
    write32: (a, v) => { const p = host(a, 4); dv.setUint32(p, v >>> 0, true); },
    readBytes(a, len) { const p = host(a, len); return u8.slice(p, p + len); },
    writeBytes(a, data) { const p = host(a, data.length); u8.set(data, p); },
    readCString(a, max = 256) {
      let s = '';
      for (let i = 0; i < max; i++) {
        const c = cpu.read8(a + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s;
    },
    reg: i => uc.reg_read_i32(REG_IDS[i]) >>> 0,
    setReg: (i, v) => uc.reg_write_i32(REG_IDS[i], v | 0),
    saveContext(ctx) {
      const ret = M._uc_reg_read_batch(handle, idsPtr, ptrsPtr, CTX_WORDS);
      if (ret !== 0) throw new Error(`uc_reg_read_batch: ${M.strerror(ret)}`);
      views();
      const vals = new Uint32Array(buf, valsPtr, CTX_WORDS);
      for (let k = 0; k < CTX_WORDS; k++) ctx[CTX_ORDER[k]] = vals[k];
    },
    restoreContext(ctx) {
      views();
      const vals = new Uint32Array(buf, valsPtr, CTX_WORDS);
      for (let k = 0; k < CTX_WORDS; k++) vals[k] = ctx[CTX_ORDER[k]];
      const ret = M._uc_reg_write_batch(handle, idsPtr, ptrsPtr, CTX_WORDS);
      if (ret !== 0) throw new Error(`uc_reg_write_batch: ${M.strerror(ret)}`);
    },
    hookCode(lo, hi, fn) {
      uc.hook_add(M.HOOK_CODE, (_h, addr) => fn(Number(addr) >>> 0), {}, lo, hi);
    },
    hookInvalid(fn) { invalidFn = fn; },
    run(count) {
      const pc = cpu.reg(R.PC) | ((cpu.reg(R.CPSR) & 0x20) ? 1 : 0);
      lastInvalid = null;
      try {
        uc.emu_start(pc, 0xffffffff, 0, count);
      } catch (e) {
        const info = lastInvalid ?? { kind: String(e).split('\n').pop(), addr: cpu.reg(R.PC), size: 0 };
        if (invalidFn) invalidFn(info.kind, info.addr, info.size);
        const err = new Error(`CPU fault: ${info.kind} at 0x${info.addr.toString(16)}, pc=0x${cpu.reg(R.PC).toString(16)}`);
        err.fault = info;
        throw err;
      }
    },
    stop() { uc.emu_stop(); },
    close() {
      uc.close();
      for (const r of regions) M._free(r.raw);
      regions.length = 0;
      M._free(scratch);
    },
  };
  return cpu;
}
