// Serve the chdb engine same-origin from a content-hashed path (/chdb-<hash>/...) so it can be
// cached immutably: a new engine build means a new URL. Generated, not committed.
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const src = new URL('../node_modules/chdb-wasm/dist/', import.meta.url);
const pub = new URL('../public/', import.meta.url);
// Only the single-threaded build ships (see src/db.ts); selectBundle looks for it under st/.
const files = ['index.js', 'worker.js', 'async.js', 'bindings.js', 'protocol.js', 'status.js', 'platform.js', 'st/chdb.mjs', 'st/chdb.wasm'];
const h = createHash('md5');
for (const f of files) h.update(readFileSync(new URL(f, src)));
const dir = `chdb-${h.digest('hex').slice(0, 12)}`;

for (const d of readdirSync(pub)) if (d === 'chdb' || d.startsWith('chdb-')) rmSync(new URL(d, pub), { recursive: true, force: true });
for (const f of files) cpSync(new URL(f, src), new URL(`${dir}/${f}`, pub));
writeFileSync(new URL('../src/engine-path.json', import.meta.url), JSON.stringify({ base: `/${dir}` }) + '\n');
console.log(`copied chdb-wasm (single-threaded bundle) -> public/${dir}`);
