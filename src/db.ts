// The only module that touches chDB. AsyncChdb already runs the wasm in its own
// Web Worker, so this is a thin wrapper, not another worker.
import type { AsyncChdb } from 'chdb-wasm';
import { paramStatements, type ParamValue } from './sql.ts';
import schemaSql from '../sql/schema.sql?raw';

type ChdbModule = typeof import('chdb-wasm');

// Loaded at runtime from /chdb (copied from node_modules by scripts/copy-chdb.mjs) so the
// package's worker and wasm resolve same-origin without the bundler rewriting them.
const ENGINE_BASE = '/chdb';

export type Row = Record<string, unknown>;

export interface Db {
  /** Run SQL with `{name:Type}` placeholders bound from `params`; returns JSONEachRow rows. */
  query<T = Row>(sql: string, params?: Record<string, ParamValue>): Promise<T[]>;
  /** Insert rows by column name via inline JSONEachRow (data after FORMAT is never parsed as SQL). */
  insert(table: string, rows: object[]): Promise<void>;
}

export interface BootProgress {
  loaded: number;
  total: number;
  attempt: number;
}

/** Same check selectBundle() does, without importing the engine (runs before anything loads). */
export function clientSupport(): { ok: true } | { ok: false; reason: 'memory64' | 'isolation' } {
  let mem64 = false;
  try {
    mem64 = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 1]));
  } catch {
    /* no wasm at all */
  }
  if (!mem64) return { ok: false, reason: 'memory64' };
  if (!self.crossOriginIsolated) return { ok: false, reason: 'isolation' };
  return { ok: true };
}

// Firefox hangs on 35-50% of boots while the engine starts its pthread pool inside the
// package's worker (docs/m0-report.md). Watchdog: if no download progress arrives and
// create() hasn't resolved for the fuse, kill the worker and retry. Fuses grow so a slow
// device that is genuinely still compiling eventually gets enough time.
// ponytail: P(all 6 hang) is about 1% at a 47% hang rate; main-thread fallback if that's too high.
const STALL_MS = [8_000, 8_000, 12_000, 12_000, 20_000, 30_000];

async function createWithWatchdog(m: ChdbModule, onProgress: (p: BootProgress) => void): Promise<AsyncChdb> {
  const bundle = m.selectBundle({ baseUrl: ENGINE_BASE, threads: 'mt' });
  if (!bundle.supported) throw new Error(`unsupported client: ${bundle.reasons.join('; ')}`);

  for (let attempt = 1; attempt <= STALL_MS.length; attempt++) {
    // ponytail: AsyncChdb doesn't expose its worker until create() resolves, and a hung
    // create() never resolves. create() constructs the Worker synchronously before its
    // first await, so capture it by wrapping the constructor for exactly that call.
    // Remove once the upstream boot hang is fixed.
    const Orig = globalThis.Worker;
    let spawned: Worker | undefined;
    globalThis.Worker = class extends Orig {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        spawned = this;
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stalled!: () => void;
    const stall = new Promise<'stall'>((resolve) => (stalled = () => resolve('stall')));
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(stalled, STALL_MS[attempt - 1]);
    };
    let created: Promise<AsyncChdb>;
    try {
      created = m.AsyncChdb.create({
        moduleUrl: bundle.moduleUrl,
        wasmUrl: bundle.wasmUrl,
        onProgress: (loaded, total) => {
          arm();
          // Vercel serves the wasm brotli-encoded without content-length: fall back to the
          // uncompressed size baked in at build time.
          onProgress({ loaded, total: total || __CHDB_WASM_BYTES__, attempt });
        },
      });
    } finally {
      globalThis.Worker = Orig;
    }
    arm();
    const winner = await Promise.race([created, stall]);
    clearTimeout(timer);
    if (winner !== 'stall') return winner;
    spawned?.terminate();
    created.catch(() => {}); // the abandoned attempt rejects or never settles
    console.warn(`[collector] engine boot stalled, retrying (attempt ${attempt + 1})`);
  }
  throw new Error('collector failed to start');
}

export async function openDb(onProgress: (p: BootProgress) => void = () => {}): Promise<Db> {
  const m: ChdbModule = await import(/* @vite-ignore */ `${ENGINE_BASE}/index.js`);
  const chdb = await createWithWatchdog(m, onProgress);

  // Params are session state, so a SET + query pair must not interleave with another
  // caller's: every engine call goes through one FIFO chain.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const raw = async (sql: string, format = 'JSONEachRow') => (await chdb.query(sql, format)).text();

  const db: Db = {
    query: <T = Row>(sql: string, params: Record<string, ParamValue> = {}) =>
      serial(async () => {
        for (const s of paramStatements(params)) await raw(s, 'CSV');
        const text = await raw(sql);
        return text
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as T);
      }),
    insert: (table, rows) =>
      serial(async () => {
        if (!/^[a-z_]+$/.test(table)) throw new Error(`invalid table ${table}`);
        if (rows.length) await raw(`INSERT INTO ${table} FORMAT JSONEachRow\n${rows.map((r) => JSON.stringify(r)).join('\n')}`, 'CSV');
      }),
  };

  for (const s of statements(schemaSql)) await db.query(s);
  return db;
}

/** Split a .sql file into statements (our schema files have no semicolons inside literals). */
export const statements = (sql: string): string[] =>
  sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

/** Truthiness of a condition query: first column of the first row. */
export function truthy(rows: Row[]): boolean {
  const v = rows[0] ? Object.values(rows[0])[0] : undefined;
  return !(v === undefined || v === null || v === 0 || v === '0' || v === '' || v === false);
}
