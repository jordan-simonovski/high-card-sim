// The only module that touches chDB. AsyncChdb already runs the wasm in its own
// Web Worker, so this is a thin wrapper, not another worker.
import { paramStatements, type ParamValue } from './sql.ts';
import schemaSql from '../sql/schema.sql?raw';

import type { AsyncChdbConnection } from 'chdb-wasm';

type ChdbModule = typeof import('chdb-wasm');

// Loaded at runtime from /chdb-<hash> (copied from node_modules by scripts/copy-chdb.mjs) so the
// package's worker and wasm resolve same-origin without the bundler rewriting them.
import enginePath from './engine-path.json';
const ENGINE_BASE = enginePath.base;

export type Row = Record<string, unknown>;

export interface ConsoleResult {
  rows: Row[];
  /** Tables the query reads, from EXPLAIN QUERY TREE (views are not expanded). */
  tables: string[];
  ms: number;
}

export interface Db {
  /** The player's SQL console: read-only connection, time and row limits. The only raw-SQL path. */
  console(sql: string): Promise<ConsoleResult>;
  /** Run SQL with `{name:Type}` placeholders bound from `params`; returns JSONEachRow rows. */
  query<T = Row>(sql: string, params?: Record<string, ParamValue>): Promise<T[]>;
  /** Insert rows by column name via inline JSONEachRow (data after FORMAT is never parsed as SQL). */
  insert(table: string, rows: object[]): Promise<void>;
}

export interface BootProgress {
  loaded: number;
  total: number;
}

/** Same check selectBundle() does, without importing the engine (runs before anything loads). */
export type Unsupported = 'memory64' | 'isolation' | 'firefox';

export function clientSupport(): { ok: true } | { ok: false; reason: Unsupported } {
  // ponytail: Firefox boots hang 35-50% of the time (docs/m0-report.md); v1 is Chromium-only.
  // A retrying watchdog that mostly works is in commit b574245 if Firefox comes back.
  if (/Firefox\//.test(navigator.userAgent)) return { ok: false, reason: 'firefox' };
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

export async function openDb(onProgress: (p: BootProgress) => void = () => {}): Promise<Db> {
  const m: ChdbModule = await import(/* @vite-ignore */ `${ENGINE_BASE}/index.js`);
  const bundle = m.selectBundle({ baseUrl: ENGINE_BASE, threads: 'mt' });
  if (!bundle.supported) throw new Error(`unsupported client: ${bundle.reasons.join('; ')}`);
  const chdb = await m.AsyncChdb.create({
    moduleUrl: bundle.moduleUrl,
    wasmUrl: bundle.wasmUrl,
    // Vercel serves the wasm brotli-encoded without content-length: fall back to the
    // uncompressed size baked in at build time.
    onProgress: (loaded, total) => onProgress({ loaded, total: total || __CHDB_WASM_BYTES__ }),
  });

  // Params are session state, so a SET + query pair must not interleave with another
  // caller's: every engine call goes through one FIFO chain.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const raw = async (sql: string, format = 'JSONEachRow') => (await chdb.query(sql, format)).text();
  const parseRows = (text: string) =>
    text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);

  // Settings first, readonly last: once readonly = 1 the session can't change them (or itself) again.
  let consoleConn: AsyncChdbConnection | undefined;
  const openConsole = async () => {
    const c = await chdb.connect();
    for (const s of ['SET max_execution_time = 3', 'SET max_result_rows = 500', "SET result_overflow_mode = 'break'", 'SET readonly = 1'])
      await c.query(s);
    return c;
  };

  const db: Db = {
    console: (input) =>
      serial(async () => {
        const sql = input.trim().replace(/;\s*$/, '');
        if (!/^(select|with|show|describe|desc|explain|exists)\b/i.test(sql))
          throw new Error('The Query Shell is read-only: start with SELECT, WITH, SHOW, DESCRIBE or EXPLAIN.');
        consoleConn ??= await openConsole();
        const t = performance.now();
        const rows = parseRows((await consoleConn.query(sql, 'JSONEachRow')).text());
        const ms = performance.now() - t;
        let tables: string[] = [];
        if (/^(select|with)\b/i.test(sql)) {
          const tree = (await consoleConn.query(`EXPLAIN QUERY TREE ${sql}`, 'TSV')).text();
          tables = [...new Set([...tree.matchAll(/table_name: ([\w.]+)/g)].map((m) => m[1]))];
        }
        return { rows, tables, ms };
      }),
    query: <T = Row>(sql: string, params: Record<string, ParamValue> = {}) =>
      serial(async () => {
        for (const s of paramStatements(params)) await raw(s, 'CSV');
        return parseRows(await raw(sql)) as T[];
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
