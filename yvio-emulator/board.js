// Virtual game board: 21 RFID antennas and the figures standing on them.
//
// From pirates/app.elf (field tables at 0x33b6c..0x33c1c, scan in FUN_0002103c / FUN_000206ac):
// - A "field" is a list of up to 5 antennas where a tag must be seen and up to 5 where it must
//   not be seen. Every field of this game uses exactly one antenna, so a figure is simply on an
//   antenna. The antenna map (0x350bf) is the identity 0..20.
// - Tag records from rfid_inventory are 12 bytes: UID at 0..7, byte 10 = (1 << 4) | 8
//   (type 1 = readable, UID length 8). rfid_read_block requires type 1.
// - The game reads 4 bytes from block 0 of each tag: [?, family, a, b]. Family 0x0e: figure
//   id = a. Ids 1..4 are the player ships; 5..8 are "wrong colour"; unknown families are
//   "foreign figures" (the other families are not emulated).

export const ANTENNAS = 21;
const BLOCK_SIZE = 4;
const BLOCKS = 16;
const FAMILY_SHIP = 0x0e;

export class Figure {
  /**
   * @param {string} name
   * @param {Uint8Array} uid  8 bytes
   * @param {Uint8Array} memory  BLOCKS * BLOCK_SIZE bytes of tag memory
   */
  constructor(name, uid, memory) {
    this.name = name;
    this.uid = uid;
    this.memory = memory;
    /** @type {number|null} antenna the figure stands on */
    this.antenna = null;
  }

  /** A player ship of the given player number (1..4). */
  static ship(player) {
    const uid = new Uint8Array([0x10 + player, 0x5e, 0x1b, 0x00, 0x00, 0x04, 0x01, 0xe0]); // E0 04 01 ... like ISO 15693
    const mem = new Uint8Array(BLOCKS * BLOCK_SIZE);
    mem.set([0x00, FAMILY_SHIP, player, 0x00]);
    return new Figure(`ship ${player}`, uid, mem);
  }
}

export class Board {
  constructor() {
    /** @type {Figure[]} */
    this.figures = [1, 2, 3, 4].map(p => Figure.ship(p));
    this.selected = -1;     // antenna chosen by rfid_select_antenna
    this.onChange = () => {};
  }

  /** Put a figure on an antenna (null = off the board). */
  place(figure, antenna) {
    figure.antenna = antenna;
    this.onChange();
  }

  /** Figures the given antenna can see. */
  at(antenna) {
    return this.figures.filter(f => f.antenna === antenna);
  }

  byUid(uid) {
    return this.figures.find(f => f.uid.every((b, i) => b === uid[i])) ?? null;
  }

  // ---- RFID syscall implementations (cpu = guest memory access) ----------------------------

  selectAntenna(n) {
    if (n < 0 || n >= ANTENNAS) return -22;
    this.selected = n;
    return 0;
  }

  /** rfid_inventory(buf, max, flags, &x): 12-byte records; returns the number of tags. */
  inventory(cpu, buf, max, _flags, px) {
    const tags = this.at(this.selected).slice(0, Math.max(0, max | 0));
    tags.forEach((f, i) => {
      const rec = new Uint8Array(12);
      rec.set(f.uid);
      rec[10] = 0x18;
      cpu.writeBytes(buf + 12 * i, rec);
    });
    if (px) cpu.write32(px, 0);
    return tags.length;
  }

  /** The figure a guest tag record refers to, if it is in range of the selected antenna. */
  tagInRange(cpu, tag) {
    if (cpu.read8(tag + 10) >> 4 !== 1) return null;
    const f = this.byUid(cpu.readBytes(tag, 8));
    return f && f.antenna === this.selected ? f : null;
  }

  /** rfid_read_block(dest, tag, block): returns the block size or a negative error. */
  readBlock(cpu, dest, tag, block) {
    if (cpu.read8(tag + 10) >> 4 !== 1) return -0x31;
    const f = this.tagInRange(cpu, tag);
    if (!f || block >= BLOCKS) return -5;
    cpu.writeBytes(dest, f.memory.subarray(block * BLOCK_SIZE, (block + 1) * BLOCK_SIZE));
    return BLOCK_SIZE;
  }

  /** rfid_write_block(tag, src, block, len) */
  writeBlock(cpu, tag, src, block, len) {
    if (cpu.read8(tag + 10) >> 4 !== 1) return -0x31;
    const f = this.tagInRange(cpu, tag);
    if (!f || block >= BLOCKS) return -5;
    const n = Math.min(len, BLOCK_SIZE);
    f.memory.set(cpu.readBytes(src, n), block * BLOCK_SIZE);
    this.onChange();
    return n;
  }

  /** rfid_uid_compare(a, b): 0 if equal (OS.elf 0x57430: type/length nibbles, then UID bytes). */
  static uidCompare(cpu, a, b) {
    if (!a || !b) return -1;
    const ta = cpu.read8(a + 10), tb = cpu.read8(b + 10);
    if ((ta >> 4) !== (tb >> 4)) return (ta >> 4) - (tb >> 4);
    if ((ta & 15) !== (tb & 15)) return (ta & 15) - (tb & 15);
    for (let i = 0; i < (ta & 15); i++) {
      const x = cpu.read8(a + i), y = cpu.read8(b + i);
      if (x < y) return -1;
      if (x !== y) return 1;
    }
    return 0;
  }

  /** Serializable state, for the UI and tests. */
  state() {
    return this.figures.map(f => ({ name: f.name, antenna: f.antenna }));
  }
}
