// M0 spike: measure chdb-wasm in the browser and publish a JSON report on window.__spike.
// Throwaway. Nothing here is game code except what gets promoted into db.ts / schema.sql.
import { openDb, statements, type Db } from './db';
import schemaSql from '../sql/schema.sql?raw';

type Report = Record<string, unknown>;
const report: Report = { ua: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated };
const out = document.querySelector('#out')!;
const show = () => (out.textContent = JSON.stringify(report, null, 2));
const now = () => performance.now();
const ms = (t: number) => Math.round(t * 10) / 10;

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
  }
}

async function timeIt(n: number, fn: () => Promise<unknown>) {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = now();
    await fn();
    xs.push(now() - t);
  }
  xs.sort((a, b) => a - b);
  return { median: ms(xs[Math.floor(n / 2)]), p95: ms(xs[Math.min(n - 1, Math.floor(n * 0.95))]), min: ms(xs[0]) };
}

// ---- synthetic events ------------------------------------------------------------
const CHARS = ['logs', 'metrics', 'traces', 'monitoring', 'collector', 'baggage', 'dba'];
const SCENES = ['prologue', 'dba_panic', 'date_logs', 'date_metrics', 'date_traces', 'cafe', 'pager'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const fmtTs = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;

function syntheticEvents(n: number, session = crypto.randomUUID()) {
  const t0 = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    event_id: crypto.randomUUID(),
    session_id: session,
    ts: fmtTs(new Date(t0 + i * 1500)),
    seq: i,
    scene: SCENES[i % SCENES.length],
    node: `n${i % 40}`,
    event_type: i % 3 ? 'choice' : 'scene_enter',
    character: CHARS[i % CHARS.length],
    choice_id: `c${i % 5}`,
    choice_text: `Choice ${i}: "it's fine", said the dashboard`,
    dialogue_text: `Line ${i}. Did you know my retention is 30 days? Anyway, as I was saying...`,
    affection_delta: (i % 7) - 3,
    time_to_choose_ms: 500 + ((i * 7919) % 9000),
    route: i % 2 ? 'pillar' : 'none',
    attributes: { 'player.pronouns': 'they/them', 'http.status': String(200 + (i % 5)), [`k${i}`]: `v${i}` },
  }));
}
const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n');

// ---- engine / feature matrix -----------------------------------------------------
const MATRIX: Record<string, string[]> = {
  MergeTree: ['CREATE TABLE m_mt (k UInt32, v String) ENGINE = MergeTree ORDER BY k'],
  SummingMergeTree: ['CREATE TABLE m_smt (k UInt32, v UInt64) ENGINE = SummingMergeTree ORDER BY k'],
  ReplacingMergeTree: ['CREATE TABLE m_rmt (k UInt32, v String) ENGINE = ReplacingMergeTree ORDER BY k'],
  AggregatingMergeTree: [
    'CREATE TABLE m_amt (k UInt32, v AggregateFunction(uniq, String)) ENGINE = AggregatingMergeTree ORDER BY k',
  ],
  Memory: ['CREATE TABLE m_mem (k UInt32, v String) ENGINE = Memory'],
  Log: ['CREATE TABLE m_log (k UInt32, v String) ENGINE = Log'],
  TinyLog: ['CREATE TABLE m_tlog (k UInt32, v String) ENGINE = TinyLog'],
  StripeLog: ['CREATE TABLE m_slog (k UInt32, v String) ENGINE = StripeLog'],
  Null: ['CREATE TABLE m_null (k UInt32, v String) ENGINE = Null'],
};

async function engineMatrix(db: Db) {
  const res: Record<string, unknown> = {};
  for (const [name, ddl] of Object.entries(MATRIX)) {
    const table = ddl[0].split(' ')[2];
    res[name] = await attempt(async () => {
      for (const s of ddl) await db.exec(s);
      if (name === 'AggregatingMergeTree')
        await db.exec(`INSERT INTO ${table} SELECT number % 3, uniqState(toString(number)) FROM numbers(10) GROUP BY number % 3`);
      else await db.exec(`INSERT INTO ${table} SELECT number % 3, ${name === 'SummingMergeTree' ? 'number' : 'toString(number)'} FROM numbers(10)`);
      if (name === 'MergeTree' || name.endsWith('MergeTree')) await db.exec(`OPTIMIZE TABLE ${table} FINAL`);
      const q = name === 'AggregatingMergeTree' ? `SELECT k, uniqMerge(v) AS v FROM ${table} GROUP BY k ORDER BY k` : `SELECT count() AS c FROM ${table}`;
      return db.rows(q);
    });
  }
  return res;
}

// ---- main --------------------------------------------------------------------------
async function main() {
  const params = new URLSearchParams(location.search);
  const threads = (params.get('threads') as 'mt' | 'st' | null) ?? 'auto';
  report.requestedThreads = threads;

  // 1. cold start
  const t0 = now();
  let firstByte = 0;
  let downloaded = 0;
  let bytes = 0;
  const db = await openDb({
    threads,
    onProgress: (loaded, total) => {
      if (!firstByte) firstByte = now();
      bytes = loaded;
      if (total && loaded >= total && !downloaded) downloaded = now();
    },
  });
  const tReady = now();
  if (!downloaded) downloaded = tReady; // no content-length: can't separate download from compile
  await db.rows('SELECT 1 AS one');
  const tFirst = now();
  report.bundle = db.bundle.variant;
  report.coldStart = {
    wasmBytes: bytes,
    toFirstByteMs: ms(firstByte - t0),
    downloadDoneMs: ms(downloaded - t0),
    compileInstantiateMs: ms(tReady - downloaded),
    createTotalMs: ms(tReady - t0),
    firstQueryMs: ms(tFirst - tReady),
    timeToFirstQueryMs: ms(tFirst - t0),
  };
  show();

  // 2. does state persist on the implicit connection?
  report.implicitConnectionKeepsState = await attempt(async () => {
    await db.exec('CREATE TABLE probe (x UInt8) ENGINE = Memory');
    await db.exec('INSERT INTO probe VALUES (1)');
    return db.rows('SELECT count() AS c FROM probe');
  });

  // 3. schema
  const tSchema = now();
  report.schema = await attempt(async () => {
    for (const s of statements(schemaSql)) await db.exec(s);
    return ms(now() - tSchema);
  });
  show();

  // 4. inserts: inline FORMAT JSONEachRow vs putFile + file()
  const evs = syntheticEvents(1000);
  report.insertInline = await attempt(async () => {
    const t = now();
    await db.exec(`INSERT INTO events FORMAT JSONEachRow\n${jsonl(evs)}`);
    return ms(now() - t);
  });
  report.insertViaFile = await attempt(async () => {
    const more = syntheticEvents(1000);
    const t = now();
    await db.chdb.putFile('/replay.jsonl', new TextEncoder().encode(jsonl(more)));
    await db.exec(`INSERT INTO events SELECT * FROM file('/replay.jsonl', 'JSONEachRow')`);
    return ms(now() - t);
  });
  report.singleRowInsertMs = await attempt(() =>
    timeIt(20, () => db.exec(`INSERT INTO events FORMAT JSONEachRow\n${jsonl(syntheticEvents(1))}`)),
  );
  report.counts = await attempt(() =>
    db.rows(`SELECT
      (SELECT count() FROM events) AS events,
      (SELECT count() FROM traces) AS traces,
      (SELECT count() FROM logs) AS logs,
      (SELECT sum(events) FROM metrics_agg) AS metrics_events`),
  );
  show();

  // 5. pillar latency
  const Q = {
    metrics: 'SELECT character, scene, sum(events) AS n, sum(affection) AS a FROM metrics_agg GROUP BY character, scene',
    traces: 'SELECT * FROM traces ORDER BY seq',
    logs: 'SELECT * FROM logs ORDER BY ts DESC LIMIT 100',
    baseAffection: 'SELECT character, sum(affection_delta) AS a, avg(time_to_choose_ms) AS hesitation FROM events GROUP BY character',
    baseFull: 'SELECT * FROM events ORDER BY seq',
    mapLookup: "SELECT count() AS c FROM events WHERE attributes['http.status'] = '503'",
  };
  const lat: Record<string, unknown> = {};
  for (const [k, q] of Object.entries(Q)) lat[k] = await attempt(() => timeIt(20, () => db.rows(q)));
  report.latencyMs = lat;
  show();

  // 6. engine matrix
  report.engines = await engineMatrix(db);
  report.features = {
    plainView: (report.schema as { ok: boolean }).ok,
    materializedView: await attempt(() => db.rows('SELECT count() AS c FROM metrics_agg')),
    windowFn: await attempt(() => db.rows('SELECT seq, sum(affection_delta) OVER (ORDER BY seq) AS running FROM events LIMIT 3')),
  };
  show();

  // 7. query parameters (needed for injection-safe player strings)
  report.params = {
    setParamImplicit: await attempt(async () => {
      await db.exec("SET param_name = 'O''Brien; DROP TABLE events'");
      return db.rows('SELECT {name:String} AS v');
    }),
    setParamOnConn: await attempt(async () => {
      const c = await db.chdb.connect();
      await c.query("SET param_name = 'Ada'");
      const r = (await c.query('SELECT {name:String} AS v', 'JSONEachRow')).text();
      await c.close();
      return r;
    }),
  };
  show();

  // 8. read-only connection for the SQL console
  report.readonly = await attempt(async () => {
    const c = await db.chdb.connect();
    const q = async (sql: string) => attempt(async () => (await c.query(sql, 'JSONEachRow')).text().slice(0, 120));
    const r = {
      setReadonly: await q('SET readonly = 1'),
      seesEventsTable: await q('SELECT count() AS c FROM events'),
      insertBlocked: await q("INSERT INTO probe VALUES (2)"),
      createBlocked: await q('CREATE TABLE evil (x UInt8) ENGINE = Memory'),
      dropBlocked: await q('DROP TABLE probe'),
      escapeBlocked: await q('SET readonly = 0'),
      fileFnBlocked: await q("SELECT * FROM file('/replay.jsonl', 'LineAsString') LIMIT 1"),
    };
    await c.close();
    return r;
  });
  show();

  // 9. timeouts and cancellation
  report.timeout = {
    maxExecutionTime: await attempt(async () => {
      const t = now();
      const r = await attempt(() => db.rows('SELECT count() FROM numbers(100000000000) SETTINGS max_execution_time = 0.5'));
      return { ...r, elapsedMs: ms(now() - t) };
    }),
    cancel: await attempt(async () => {
      if (db.bundle.variant !== 'mt') return 'n/a on st';
      const t = now();
      const p = attempt(() => db.rows('SELECT count() FROM numbers(100000000000)'));
      setTimeout(() => db.chdb.cancel(), 300);
      const r = await p;
      return { ...r, elapsedMs: ms(now() - t) };
    }),
  };
  show();

  // 10. memory
  report.memory = {
    engineMemoryTracking: await attempt(() =>
      db.rows("SELECT formatReadableSize(value) AS v FROM system.metrics WHERE metric = 'MemoryTracking'"),
    ),
    // mt only: AsyncChdb keeps a view on the shared wasm heap (private field; spike-only peek).
    wasmHeapMB: (() => {
      const b = (db.chdb as unknown as { progressView?: BigInt64Array }).progressView?.buffer;
      return b ? Math.round(b.byteLength / 1048576) : 'n/a (st heap not shared)';
    })(),
  };

  report.done = true;
  show();
}

// Persistence probe: boot, list tables, nothing else.
async function persistProbe() {
  const t0 = now();
  report.stage = 'importing';
  const db = await openDb({
    onProgress: (loaded, total) => {
      report.stage = loaded >= total ? `downloaded@${ms(now() - t0)}` : `downloading ${loaded}/${total}`;
    },
  });
  report.stage = `created@${ms(now() - t0)}`;
  report.tablesAtBoot = await db.rows("SELECT name FROM system.tables WHERE database = currentDatabase()");
  report.done = true;
  show();
}

// Diagnostic: instantiate the engine on the MAIN thread (pthreads spawned from the page,
// not from a nested worker). Blocks the UI; only used to isolate the Firefox boot hang.
async function mainThreadProbe() {
  const t0 = now();
  report.stage = 'importing';
  const factory = (await import(/* @vite-ignore */ String('/chdb/chdb.mjs'))).default;
  const { ChdbBindings } = await import(/* @vite-ignore */ String('/chdb/bindings.js'));
  report.stage = 'instantiating';
  const mod = await factory({});
  report.stage = `created@${ms(now() - t0)}`;
  const b = new ChdbBindings(mod);
  const r = await b.query('SELECT 1', 'CSV');
  report.tablesAtBoot = new TextDecoder().decode(r.data);
  report.done = true;
  show();
}

(window as unknown as { __spike: Report }).__spike = report;
const probe = new URLSearchParams(location.search).get('probe');
if (probe === 'main') mainThreadProbe().catch((e) => { report.fatal = String(e?.message ?? e); report.done = true; show(); });
else
(new URLSearchParams(location.search).get('probe') === 'persist' ? persistProbe() : main()).catch((e) => {
  report.fatal = String(e?.message ?? e);
  report.done = true;
  show();
});
