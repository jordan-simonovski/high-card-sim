# M0 spike report: chdb-wasm in the browser

Date: 2026-11-13. Package: `chdb-wasm@0.4.0` (pinned). Machine: Apple Silicon Mac.
Browsers: Playwright Chromium 158 (headless shell) and Playwright Firefox.
Reproduce: `npm install && npm run spike` (writes `spike-results/*.json`).
Boot stress test: `PROBE=persist BOOTS=20 HANG_MS=15000 npx playwright test boot-loop`.

## Verdict: GO, with three changes to the plan

1. **Ship only the multi-threaded (mt) build, and keep COOP/COEP.** The single-threaded (st) build can't run MergeTree (details below).
2. **Firefox needs a boot watchdog.** About 1 in 3 Firefox boots hang while the engine starts its thread pool inside its worker. Options are listed below.
3. **There is no deferred module to lazy-load.** 0.4.0 ships one 158 MB wasm, which compresses to 24.9 MB with Vercel's on-the-fly brotli. The prologue has to cover that download.

Memory use is the main open risk for "works on a Chromium phone".

## What the plan assumed vs what's true

| Plan | Reality |
|---|---|
| ~95 MB engine split into a hot module and a lazily loaded deferred one | One `chdb.wasm` of 158,133,955 bytes. Gzip -6: 28.7 MB. Brotli -9: 19.1 MB. Vercel's on-the-fly brotli: 24.9 MB. |
| `query(sql, params)` | `query(sql, format)`. Parameters work through `SET param_x = '…'` plus `{x:Type}` placeholders (see below). |
| We wrap chDB in a Web Worker | `AsyncChdb` already runs the wasm in its own worker. `src/db.ts` is a thin wrapper and the only chDB touchpoint. |
| Memory64 detection we write ourselves | `selectBundle()` / `getPlatformFeatures()` in the package already does this. |

## Cold start

Timings run from navigation to the first `SELECT 1` result. "Create" means download plus compile and instantiate.

| | create | first query | **time to first query** |
|---|---|---|---|
| Chromium mt, localhost, cold | 444 ms | 541 ms | **~1.0 s** |
| Chromium mt, localhost, warm cache | 386 ms | 54 ms | **~0.45 s** (code cache) |
| Firefox mt, localhost, cold | 1,676 ms (compile 1,447) | 75 ms | **~1.75 s** |
| Firefox mt, localhost, warm cache | 1,484 ms | 71 ms | **~1.55 s** |
| Chromium mt, Vercel prod from Sydney, cold (CDN MISS, TTFB 1.2 s) | 2,621 ms | 504 ms | **3.1 s** |
| Chromium mt, Vercel prod, warm (revalidated, `max-age=0`) | 1,700 ms | 53 ms | **1.75 s** |

Estimated download time for real players, using the Vercel brotli size (24.9 MB) vs a pre-compressed brotli -9 file (19.1 MB):

| connection | Vercel br | pre-compressed br-9 |
|---|---|---|
| 10 Mbps | ~20 s | ~15 s |
| 20 Mbps | ~10 s | ~7.6 s |
| 50 Mbps | ~4 s | ~3 s |

Add about 1 s on Chromium or about 2 s on Firefox for compile and first query. **The prologue needs roughly 15–25 s of reading before it requires a query.** That's realistic for a VN opening, and the prologue can't depend on queries anyway.

Notes:
- Chromium compiles the wasm lazily, so compile looks cheap and the first query pays about 500 ms. On a warm cache, the code cache cuts that first query to about 50 ms.
- With `Content-Encoding: br`, Vercel sends no `content-length`, so the package's progress callback reports `total = 0`. The in-world loader needs the expected size baked in at build time.
- Vercel served `cache-control: public, max-age=0, must-revalidate`. M6 should copy the chdb-wasm repo's content-hashed `dist-<hash>/` directory with `immutable` caching. That removes the revalidation round trip, and pre-compressing at brotli -9/11 could save about 6 MB.

## Memory

| | before (about:blank) | after spike | delta |
|---|---|---|---|
| Chromium mt, total browser RSS | 602 MB | 2,227 MB | **~+1.6 GB** |
| Firefox mt, total browser RSS | 909 MB | 2,712 MB | **~+1.8 GB** |

- The wasm linear memory (mt shared heap) is 128 MB at its initial size. ClickHouse's `MemoryTracking` reports 31.5 MiB.
- The RSS numbers are rough: shared pages get counted more than once. The gap between 128 MB of heap and over 1.5 GB of RSS most likely comes from the 158 MB of compiled code, the copies of the wasm bytes made during load, and the 16-thread pool with its per-thread stacks. The package's README says the pool size dominates baseline memory.
- **Risk:** this could get the tab killed on low-end Android. Pool size and stack sizes are build-time settings in chdb, so reducing them means a custom build or an upstream request. We should measure on a real phone in M1.

## Query latency (2,020 events, 20 runs, median / p95 ms)

| query | Chromium | Firefox |
|---|---|---|
| Metrics (SummingMergeTree, GROUP BY) | 4.8 / 6.5 | 3.6 / 4.8 |
| Traces view (1% sample, ORDER BY) | 9.2 / 16.2 | 8.6 / 9.6 |
| Logs view (last 100) | 6.0 / 45.6 | 4.5 / 5.2 |
| Base table affection aggregate | 4.5 / 6.7 | 3.1 / 3.5 |
| Base table full scan, ordered | 13.8 / 17.5 | 16.3 / 20.8 |
| `attributes['http.status']` Map lookup | 3.2 / 8.3 | 2.2 / 5.2 |

Inserts:
- 1,000 rows of inline `INSERT … FORMAT JSONEachRow`: 31–68 ms.
- 1,000 rows via `putFile` plus `INSERT … SELECT FROM file()`: 23–31 ms. This is the faster replay path.
- Single-row insert: about 10 ms median, which is fine for one event per player action.

The Traces view sampled 18 of 2,020 events (0.9%), as designed.

## Table engines and features (mt build)

All of these pass:
- engines: MergeTree, SummingMergeTree, ReplacingMergeTree, AggregatingMergeTree (`uniqState`/`uniqMerge`), Memory, Log, TinyLog, StripeLog, Null
- views: MATERIALIZED VIEW `TO` a table, plain VIEW
- functions: window functions, `cityHash64`
- types: `Map(String,String)`, `LowCardinality`, `UUID`, `DateTime64(3)`

The implicit connection keeps state across queries, and a second `connect()` sees the same tables.

**The st build fails:** every MergeTree-family and Log-family engine errors with `Code: 439 Cannot schedule a task: thread creation`, and only Memory and Null work. On Firefox, st hung at boot. The st build is not an option.

## Safe parameters (no string concatenation)

`SET param_name = '…'` followed by `SELECT {name:String}` works on both the implicit and an explicit connection. The test value `O'Brien; DROP TABLE events` came back literally.

There are two consequences for M1:
- The `SET` statement still needs the value as a string literal. So there is still **one audited helper**: it escapes only `\` and `'` for the `SET` literal, and every query uses typed `{x:Type}` placeholders.
- Params are session state. `db.ts` must run each SET-then-query pair without another caller's query interleaving. The worker is FIFO, but two async callers could interleave between the two statements.

## Read-only SQL console (M4)

On a dedicated connection, after `SET readonly = 1`:
- SELECT on `events` works.
- INSERT, CREATE, DROP and `file()` are all rejected (`Code: 164 READONLY`).
- `SET readonly = 0` is rejected too, so the player can't switch read-only off.

Timeouts: `SETTINGS max_execution_time = 0.5` stopped a huge scan at 501 ms with `TIMEOUT_EXCEEDED`, and `cancel()` stopped one at 303 ms. Both are usable for the console.

## Persistence

The engine's virtual filesystem is in-memory only (`MEMFS`, no IDBFS or OPFS), and after a reload the table list was empty. This confirms the IndexedDB event log as the source of truth.

## Firefox boot hang

Hang rate when instantiating the engine (each boot on a fresh page, counted as a hang after 15 s; a normal boot takes about 2 s):

| mode | Firefox | Chromium |
|---|---|---|
| `AsyncChdb` (engine in the package's worker, pthreads spawned from that worker) | **13/20 ok (35% hang)** | 8/8 ok |
| Engine instantiated on the main thread (pthreads spawned from the page) | **20/20 ok** | not needed |

The hang happens after the wasm download finishes, during Emscripten instantiation, which includes starting the pthread pool. Firefox only prints a warning that the `try` exception instruction is deprecated, nothing else.

Isolating it to the main thread points at nested-worker pthread startup on Firefox, which is upstream in chdb's dispatcher worker or in Firefox, not in our code.

Options:
1. **Watchdog plus retry (recommended for M1):** if `AsyncChdb.create` hasn't resolved within about 8 s, terminate it and recreate. With a 35% hang rate, all three attempts hang about 4% of the time. The prologue hides the extra time. About 15 lines in `db.ts`.
2. Host the engine on the main thread on Firefox only. It boots reliably, but every query blocks the UI (single-digit ms normally, around 75 ms for the first query) and it means two code paths.
3. Host on the main thread everywhere. One code path, but it breaks the "chDB runs in a worker" rule and risks UI jank.
4. **File an upstream issue on chdb-io/chdb-core** with the `boot-loop` spec as the repro. This is worth doing whichever option we pick.

## Browser support

- `selectBundle()` reports `supported: false` with reasons when Memory64 is missing. That's the hook for the unsupported-client screen.
- Not tested on real Safari: M1 adds a Playwright WebKit check.

## Vercel

- Deployed `high-card-sim` with `vercel.json` setting COOP/COEP on every path. The page reports `crossOriginIsolated: true` in production.
- The 158 MB wasm deployed fine. Vercel installs `chdb-wasm` at build time, and `postinstall` copies it into `public/chdb`, so nothing large is uploaded from a laptop. The deploy took about 10 s.
- The project has Vercel Authentication on. Tests use a `_vercel_share` link through `SHARE_URL`.
