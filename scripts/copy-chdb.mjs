// Serve the chdb engine same-origin from a stable path (/chdb/...). Not committed.
import { cpSync, rmSync } from 'node:fs';
const src = new URL('../node_modules/chdb-wasm/dist/', import.meta.url);
const dst = new URL('../public/chdb/', import.meta.url);
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith('.map') && !p.endsWith('.d.ts') });
console.log('copied chdb-wasm dist -> public/chdb');
