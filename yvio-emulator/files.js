// Virtual SD card: an in-memory, case-insensitive file tree (FAT is case-insensitive).
// Sources: a folder (browser FileList / drag and drop, or Node directory via test/node-files.js)
// and .zip archives. Raw card images come later (milestone 5).

/** Normalize a guest or host path: forward slashes, no leading slash, no "." parts. */
export function normPath(p) {
  const parts = [];
  for (const part of String(p).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.join('/');
}

/** Folders at the card root that belong to the console, not to a game (lower case). */
export const CARD_FOLDERS = ['emulator', 'menu', 'osup', 'system'];

export class Vfs {
  constructor() {
    /** @type {Map<string, {path:string, data:Uint8Array}>} lowercased path -> file */
    this.files = new Map();
  }

  /** Add or replace a file. A replaced file keeps its name's case, as on FAT. */
  add(path, data) {
    const p = normPath(path);
    const key = p.toLowerCase();
    this.files.set(key, { path: this.files.get(key)?.path ?? p, data });
  }

  /** @returns {Uint8Array|null} */
  get(path) {
    return this.files.get(normPath(path).toLowerCase())?.data ?? null;
  }

  has(path) { return this.files.has(normPath(path).toLowerCase()); }

  isDir(path) {
    const d = normPath(path).toLowerCase();
    if (!d) return true;
    for (const k of this.files.keys()) if (k.startsWith(d + '/')) return true;
    return false;
  }

  /**
   * Directory entries (files and subdirectories) of a directory, in insertion order.
   * @returns {{name:string, isDir:boolean, size:number}[]}
   */
  list(dir) {
    const d = normPath(dir).toLowerCase();
    const prefix = d ? d + '/' : '';
    const seen = new Map();
    for (const [k, f] of this.files) {
      if (!k.startsWith(prefix)) continue;
      const rest = f.path.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash < 0 ? rest : rest.slice(0, slash);
      if (!seen.has(name.toLowerCase()))
        seen.set(name.toLowerCase(), { name, isDir: slash >= 0, size: slash < 0 ? f.data.length : 0 });
    }
    return [...seen.values()];
  }

  /**
   * If the card sits below extra folders (e.g. the user picked "sdcard/"), strip them so that the
   * card root is the root. The card root is the shallowest folder with a "system/" folder (the OS
   * sounds, on every Yvio card); without one, the folders all files have in common, keeping at
   * least one folder (the game folder) above each file.
   */
  rerootAtCard() {
    const paths = [...this.files.keys()];
    let prefix = null;
    for (const k of paths) {
      const m = /^(.*\/)?system\//.exec(k);
      const p = m?.[1] ?? '';
      if (m && (prefix === null || p.split('/').length < prefix.split('/').length)) prefix = p;
    }
    if (prefix === null && paths.length) {
      const dirs = paths.map(k => k.split('/').slice(0, -1));
      const common = [];
      const keep = Math.min(...dirs.map(d => d.length)) - 1;
      for (let i = 0; i < keep && dirs.every(d => d[i] === dirs[0][i]); i++) common.push(dirs[0][i]);
      prefix = common.map(c => c + '/').join('');
    }
    if (!prefix) return;
    const old = [...this.files.values()];
    this.files.clear();
    for (const f of old)
      if (f.path.toLowerCase().startsWith(prefix)) this.add(f.path.slice(prefix.length), f.data);
  }

  /**
   * Remove all files below a folder (e.g. "emulator", the page's own extras on the card).
   * @returns {{path:string, data:Uint8Array}[]}  paths relative to that folder
   */
  take(dir) {
    const prefix = normPath(dir).toLowerCase() + '/';
    const out = [];
    for (const [k, f] of this.files) {
      if (!k.startsWith(prefix)) continue;
      out.push({ path: f.path.slice(prefix.length), data: f.data });
      this.files.delete(k);
    }
    return out;
  }

  /**
   * The game folders: folders at the root, other than CARD_FOLDERS, that hold an app.elf
   * (e.g. "pirates"). Sorted; empty if this is not a game card.
   */
  games() {
    return this.list('')
      .filter(e => e.isDir && !CARD_FOLDERS.includes(e.name.toLowerCase()) && this.has(`${e.name}/app.elf`))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * The languages of a game folder (from GAME/lang.txt, see readLanguages), or null. `game` ''
   * means the card root: the console menu's lang.txt (same format).
   */
  languages(game) {
    return readLanguages(this.get(`${game}/lang.txt`));
  }

  /**
   * Select a language for the next boot: writes its index into GAME/lang.txt.
   * @returns {boolean} false if the game has no such language
   */
  setLanguage(game, code) {
    const langs = this.languages(game);
    const i = langs?.languages.findIndex(l => l.code.toLowerCase() === String(code).toLowerCase()) ?? -1;
    if (i < 0) return false;
    const path = this.files.get(normPath(`${game}/lang.txt`).toLowerCase()).path;
    this.add(path, withLanguage(this.get(path), i));
    return true;
  }

  /**
   * Build from a browser FileList (input webkitdirectory or drag and drop), using webkitRelativePath.
   * @param {Iterable<File>} fileList
   */
  static async fromFileList(fileList) {
    const vfs = new Vfs();
    for (const f of fileList) vfs.add(f.webkitRelativePath || f.name, new Uint8Array(await f.arrayBuffer()));
    vfs.rerootAtCard();
    return vfs;
  }

  /**
   * Build from a .zip archive (stored or deflate entries; uses the built-in DecompressionStream).
   * @param {Uint8Array} zip
   */
  static async fromZip(zip) {
    const vfs = new Vfs();
    for (const e of zipEntries(zip)) {
      if (e.name.endsWith('/')) continue;
      vfs.add(e.name, await zipExtract(zip, e));
    }
    vfs.rerootAtCard();
    return vfs;
  }
}

/**
 * Parse a game's lang.txt: u8 count, u8 selected index, then per language u8 length, the name
 * (e.g. "english") and a 2-letter code ("en"). The game builds texts_??.txt, files_??.txt,
 * menu/??_menu.txt and sounds/??/ from the selected code; without the file it uses German. Its own
 * menu offers the choice only with 2 or more languages and saves it by writing byte 1.
 * @param {Uint8Array|null} bytes
 * @returns {{selected:number, languages:{name:string, code:string}[]} | null}  null if missing or empty
 */
export function readLanguages(bytes) {
  if (!bytes || bytes.length < 2) return null;
  const dec = new TextDecoder('latin1');
  const languages = [];
  // like the game: stop at the first entry that is cut short
  for (let i = 0, p = 2; i < bytes[0]; i++) {
    const len = bytes[p];
    if (len === undefined || p + 1 + len + 2 > bytes.length) break;
    languages.push({ name: dec.decode(bytes.subarray(p + 1, p + 1 + len)), code: dec.decode(bytes.subarray(p + 1 + len, p + 3 + len)) });
    p += 3 + len;
  }
  if (!languages.length) return null;
  return { selected: bytes[1] < languages.length ? bytes[1] : 0, languages };
}

/** A copy of lang.txt with language `index` selected. */
export function withLanguage(bytes, index) {
  const out = bytes.slice();
  out[1] = index;
  return out;
}

/** Parse the central directory of a zip file. */
export function zipEntries(zip) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 0x10016); i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file (no end of central directory)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (p === 0xffffffff || count === 0xffff) throw new Error('zip64 archives are not supported');
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    out.push({ name: dec.decode(zip.subarray(p + 46, p + 46 + nlen)), method, csize, size, local });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

async function zipExtract(zip, e) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
  const raw = zip.subarray(start, start + e.csize);
  if (e.method === 0) return raw.slice();
  if (e.method !== 8) throw new Error(`zip entry ${e.name}: unsupported compression ${e.method}`);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
