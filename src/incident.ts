// The Realm's own telemetry during the Sev-1: request spans and service log lines, generated
// deterministically from the session ID so a replayed save gets the same incident. These rows go
// straight into chDB, never into the event log; the log only holds the markers (incident_started,
// trace_kept), and restoreIncident() regenerates from them after a replay. Pure TS, no DOM.
import type { GameEvent } from './eventlog.ts';
import type { Db } from './db.ts';

export const FAILING_REQUEST = 'the-one-that-never-finishes';
export const CARDINALITY_WARN = 'cardinality limit exceeded, dropping series';
const WINDOW_MS = 20 * 60_000; // the incident's history: the 20 minutes before it was declared
const TRACES = 360;
const NOISE_LOGS = 1800;

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const hex = (r: Rand, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r: Rand) => `${hex(r, 8)}-${hex(r, 4)}-4${hex(r, 3)}-a${hex(r, 3)}-${hex(r, 12)}`;
const pickOf = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const fmt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
const parse = (ts: string) => Date.parse(ts.replace(' ', 'T') + 'Z');

function row(sessionId: string, r: Rand, ms: number, event_type: string, node: string, text: string, attributes: Record<string, string>): GameEvent {
  return {
    event_id: uuid(r), session_id: sessionId, ts: fmt(ms), seq: 0, scene: 'incident', node, event_type,
    character: 'realm', choice_id: '', choice_text: '', dialogue_text: text, affection_delta: 0,
    time_to_choose_ms: 0, route: '', attributes,
  };
}

const PATHS = [
  ['gateway', 'checkout', 'cart', 'collector.batch_processor'],
  ['gateway', 'checkout', 'payments', 'collector.batch_processor'],
  ['gateway', 'registry', 'collector.batch_processor'],
] as const;
const REQUESTS = ['GET /checkout', 'POST /cart/items', 'POST /payments', 'GET /registry/citizens'];
const PRO_IDS = ['sub_pro_ada', 'sub_pro_bix', 'sub_pro_cyd', 'sub_pro_dov', 'sub_pro_eli', 'sub_pro_fen'];

/** One request: a chain of spans, each the child of the one before. */
function trace(sessionId: string, r: Rand, t0: number, tier: string, request: string, fails: boolean, extra: Record<string, string> = {}) {
  const trace_id = hex(r, 32);
  const subscriber_id = tier === 'onlyspans' ? `sub_os_${hex(r, 10)}` : tier === 'pro' ? pickOf(r, PRO_IDS) : 'free';
  const path = pickOf(r, PATHS);
  const spans: GameEvent[] = [];
  let parent = '';
  let t = t0;
  for (const [i, service] of path.entries()) {
    const span_id = hex(r, 16);
    const last = i === path.length - 1;
    const status = fails && last ? 'error' : 'ok';
    const duration = status === 'error' ? 30_000 : Math.round(4 + r() * 60);
    spans.push(row(sessionId, r, t, 'realm_span', service, `${service} ${request}`, {
      service, status, tier, subscriber_id, trace_id, span_id, parent_span_id: parent,
      duration_ms: String(duration), request, ...extra,
    }));
    parent = span_id;
    t += 1 + Math.floor(r() * 5);
  }
  return spans;
}

/** Everything the incident wrote before anyone looked: spans for ~360 requests and ~2,000 log lines. */
export function incidentRows(sessionId: string, startedTs: string): GameEvent[] {
  const r = rng(sessionId + ':incident');
  const end = parse(startedTs);
  const begin = end - WINDOW_MS;
  const rows: GameEvent[] = [];

  for (let i = 0; i < TRACES; i++) {
    const p = i / TRACES; // OnlySpans traffic ramps up across the window; so do the errors
    const t0 = begin + p * WINDOW_MS + r() * (WINDOW_MS / TRACES);
    const tier = r() < 0.1 + 0.6 * p ? 'onlyspans' : r() < 0.4 ? 'pro' : 'free';
    const fails = tier === 'onlyspans' ? r() < 0.75 : r() < 0.01;
    const spans = trace(sessionId, r, t0, tier, pickOf(r, REQUESTS), fails);
    rows.push(...spans);
    const last = spans[spans.length - 1];
    if (fails) {
      rows.push(row(sessionId, r, Math.min(parse(last.ts) + 30_000, end), 'realm_log', 'collector.batch_processor',
        `ERROR export failed: deadline exceeded (trace ${last.attributes.trace_id.slice(0, 8)})`,
        { level: 'ERROR', service: 'collector.batch_processor', trace_id: last.attributes.trace_id }));
    }
    if (tier === 'onlyspans' && r() < 0.35) {
      rows.push(row(sessionId, r, t0 + 2, 'realm_log', 'metrics', `WARN ${CARDINALITY_WARN}`,
        { level: 'WARN', service: 'metrics', attribute: 'subscriber_id' }));
    }
  }

  const info = [
    (s: string) => `INFO ${s} handled request in ${Math.round(4 + r() * 60)}ms`,
    () => `INFO batch exported ${64 * (1 + Math.floor(r() * 8))} spans`,
    () => `INFO citizen ${hex(r, 6)} checked in at the Registry`,
    () => `INFO cache hit ratio ${(0.8 + r() * 0.19).toFixed(2)}`,
    () => 'INFO heartbeat ok',
  ];
  const warn = ['WARN slow query on registry.citizens (812ms)', 'WARN retrying upstream payments (attempt 2)', 'WARN baggage header exceeds 8KB, truncating'];
  const services = ['gateway', 'checkout', 'cart', 'payments', 'registry'];
  for (let i = 0; i < NOISE_LOGS; i++) {
    const service = pickOf(r, services);
    const isWarn = r() < 0.02;
    rows.push(row(sessionId, r, begin + r() * WINDOW_MS, 'realm_log', service,
      isWarn ? pickOf(r, warn) : pickOf(r, info)(service), { level: isWarn ? 'WARN' : 'INFO', service }));
  }
  return rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/** The failing request, kept by tail sampling: its whole path, every span marked sampling.priority=1. */
export function keptTraceRows(sessionId: string, startedTs: string): GameEvent[] {
  const r = rng(sessionId + ':kept');
  return trace(sessionId, r, parse(startedTs) - 90_000, 'onlyspans', FAILING_REQUEST, true, { 'sampling.priority': '1' });
}

/** After a replay: regenerate whatever the logged markers say happened. */
export async function restoreIncident(db: Db, events: GameEvent[]): Promise<void> {
  const started = events.find((e) => e.event_type === 'incident_started');
  if (!started) return;
  await db.insert('events', incidentRows(started.session_id, started.ts));
  if (events.some((e) => e.event_type === 'trace_kept')) await db.insert('events', keptTraceRows(started.session_id, started.ts));
}
