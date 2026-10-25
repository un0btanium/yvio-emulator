// Node-only: load a host directory (e.g. cards/freibeuter-der-karibik/original/) into a Vfs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Vfs } from '../yvio-emulator/files.js';

/** @param {...string} dirs  later directories override earlier ones (e.g. cards/freibeuter-der-karibik/original/ then a patched card) */
export function vfsFromDirs(...dirs) {
  const vfs = new Vfs();
  for (const root of dirs) {
    const walk = d => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else vfs.add(relative(root, p), new Uint8Array(readFileSync(p)));
      }
    };
    walk(root);
  }
  return vfs;
}
