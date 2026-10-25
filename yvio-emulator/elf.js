// ELF32 (little-endian ARM) loader. Like the kuma OS loader, it uses only the program
// headers (PT_LOAD); section headers are ignored.

/** @typedef {{vaddr:number, paddr:number, offset:number, filesz:number, memsz:number, flags:number}} Segment */

/**
 * @param {Uint8Array} bytes
 * @returns {{entry:number, segments:Segment[]}}
 */
export function parseElf(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== 0x7f454c46) throw new Error('not an ELF file');
  if (bytes[4] !== 1 || bytes[5] !== 1) throw new Error('not a 32-bit little-endian ELF');
  if (dv.getUint16(18, true) !== 40) throw new Error('not an ARM ELF');
  const entry = dv.getUint32(24, true);
  const phoff = dv.getUint32(28, true), phentsize = dv.getUint16(42, true), phnum = dv.getUint16(44, true);
  if (phentsize !== 0x20) throw new Error(`unexpected phentsize ${phentsize}`);
  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (dv.getUint32(o, true) !== 1) continue; // PT_LOAD only
    segments.push({
      offset: dv.getUint32(o + 4, true), vaddr: dv.getUint32(o + 8, true), paddr: dv.getUint32(o + 12, true),
      filesz: dv.getUint32(o + 16, true), memsz: dv.getUint32(o + 20, true), flags: dv.getUint32(o + 24, true),
    });
  }
  return { entry, segments };
}

/**
 * Copy the PT_LOAD segments into guest memory. A segment whose load address (paddr) lies in
 * flash is also written there, because the app's startup code copies .data from flash to RAM.
 * @param {import('./cpu.js').Cpu} cpu
 * @param {Uint8Array} bytes
 * @param {{flashLo:number, flashHi:number}} flash
 */
export function loadElf(cpu, bytes, flash) {
  const elf = parseElf(bytes);
  for (const s of elf.segments) {
    const data = bytes.subarray(s.offset, s.offset + s.filesz);
    if (s.filesz && s.paddr !== s.vaddr && s.paddr >= flash.flashLo && s.paddr + s.filesz <= flash.flashHi)
      cpu.writeBytes(s.paddr, data);
    if (s.filesz) cpu.writeBytes(s.vaddr, data);
    // memsz beyond filesz (.bss) is left zero: guest memory starts zeroed.
  }
  return elf;
}
