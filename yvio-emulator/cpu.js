// CPU interface shared by the backends (cpu-unicorn.js, later cpu-interp.js).
// The rest of the emulator only talks to this interface, never to Unicorn directly.

/** Register indices used by the interface: 0..15 = r0..r15, 16 = CPSR. */
export const R = { SP: 13, LR: 14, PC: 15, CPSR: 16 };

/** Number of registers in a saved task context (r0..r15 + CPSR). */
export const CTX_WORDS = 17;

/**
 * @typedef {object} Cpu
 * @property {string} name                                  backend name
 * @property {(addr:number, size:number) => void} mapMemory  map RWX memory (4 KB aligned)
 * @property {(addr:number) => number} read8
 * @property {(addr:number) => number} read16
 * @property {(addr:number) => number} read32
 * @property {(addr:number, v:number) => void} write8
 * @property {(addr:number, v:number) => void} write16
 * @property {(addr:number, v:number) => void} write32
 * @property {(addr:number, len:number) => Uint8Array} readBytes   copy out of guest memory
 * @property {(addr:number, data:Uint8Array) => void} writeBytes  copy into guest memory
 * @property {(addr:number, max?:number) => string} readCString   latin-1 C string
 * @property {(i:number) => number} reg                      read register (R indices), unsigned
 * @property {(i:number, v:number) => void} setReg           write register
 * @property {(ctx:Uint32Array) => void} saveContext         r0..r15, CPSR into ctx (CTX_WORDS)
 * @property {(ctx:Uint32Array) => void} restoreContext      the inverse; writes CPSR first
 * @property {(lo:number, hi:number, fn:(addr:number) => void) => void} hookCode
 *           call fn before executing any instruction in [lo, hi]; fn may change PC or call stop()
 * @property {(fn:(kind:string, addr:number, size:number) => void) => void} hookInvalid
 *           called on unmapped/protected memory access or invalid instruction (emulation stops)
 * @property {(count:number) => void} run                    run from current PC, at most count instructions
 * @property {() => void} stop                               stop run() from inside a hook
 * @property {() => void} close                              release the engine and its memory
 */

/**
 * Create a CPU backend.
 * @param {'unicorn'} kind
 * @param {object} [opts]  backend options (unicorn: {url} of unicorn_arm.js in the browser)
 * @returns {Promise<Cpu>}
 */
export async function createCpu(kind = 'unicorn', opts = {}) {
  if (kind === 'unicorn') {
    const { createUnicornCpu } = await import('./cpu-unicorn.js');
    return createUnicornCpu(opts);
  }
  throw new Error(`unknown CPU backend ${kind}`);
}
