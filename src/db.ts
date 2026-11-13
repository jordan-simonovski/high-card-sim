// The only module that touches chDB. AsyncChdb already runs the wasm in its own
// Web Worker, so this is a thin wrapper, not another worker.
import type { AsyncChdb, BundleConfig } from 'chdb-wasm';

type ChdbModule = typeof import('chdb-wasm');

// Loaded at runtime from /chdb (copied from node_modules by scripts/copy-chdb.mjs) so the
// package's worker and wasm resolve same-origin without the bundler rewriting them.
const ENGINE_BASE = '/chdb';
const loadChdb = (): Promise<ChdbModule> => import(/* @vite-ignore */ `${ENGINE_BASE}/index.js`);

export interface Db {
  chdb: AsyncChdb;
  bundle: BundleConfig;
  /** Run a statement and parse JSONEachRow output. */
  rows<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export async function openDb(opts: {
  threads?: 'auto' | 'mt' | 'st';
  onProgress?: (loaded: number, total: number) => void;
}): Promise<Db> {
  const m = await loadChdb();
  const bundle = m.selectBundle({ baseUrl: ENGINE_BASE, threads: opts.threads ?? 'auto' });
  if (!bundle.supported) throw new Error(`unsupported client: ${bundle.reasons.join('; ')}`);
  const chdb = await m.AsyncChdb.create({
    moduleUrl: bundle.moduleUrl,
    wasmUrl: bundle.wasmUrl,
    onProgress: opts.onProgress,
  });
  return {
    chdb,
    bundle,
    async rows<T>(sql: string) {
      const text = (await chdb.query(sql, 'JSONEachRow')).text();
      return text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as T);
    },
    async exec(sql: string) {
      await chdb.query(sql);
    },
  };
}

/** Split a .sql file into statements (no semicolons inside literals in our schema files). */
export const statements = (sql: string): string[] =>
  sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
