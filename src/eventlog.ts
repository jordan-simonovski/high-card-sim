// Append-only event log in IndexedDB. This IS the save file; chDB is a rebuildable read side.
import type { Db } from './db.ts';

export interface GameEvent {
  event_id: string;
  session_id: string;
  ts: string; // 'YYYY-MM-DD hh:mm:ss.sss' UTC, DateTime64(3)
  seq: number;
  scene: string;
  node: string;
  event_type: string;
  character: string;
  choice_id: string;
  choice_text: string;
  dialogue_text: string;
  affection_delta: number;
  time_to_choose_ms: number;
  route: string;
  attributes: Record<string, string>;
}

export type NewEvent = Partial<Omit<GameEvent, 'event_id' | 'session_id' | 'ts' | 'seq'>> &
  Pick<GameEvent, 'scene' | 'event_type'>;

export interface EventLog {
  sessionId: string;
  append(e: NewEvent): Promise<GameEvent>;
  all(): Promise<GameEvent[]>;
  /** Replay the whole log into chDB, then mirror every later append into it. */
  attach(db: Db): Promise<number>;
  exportJsonl(): Promise<string>;
  /** Replace the whole log (save import, new session). The page reloads afterwards. */
  replace(events: GameEvent[]): Promise<void>;
}

const IDB_NAME = 'high-cardinality';
const STORE = 'events';
const REPLAY_BATCH = 5000;

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function openIdb(): Promise<IDBDatabase> {
  const r = indexedDB.open(IDB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'seq' });
  return req(r);
}

const tsNow = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

export async function openLog(): Promise<EventLog> {
  const idb = await openIdb();
  const store = (mode: IDBTransactionMode) => idb.transaction(STORE, mode).objectStore(STORE);
  const all = () => req(store('readonly').getAll()) as Promise<GameEvent[]>;

  const last = (await req(store('readonly').openCursor(null, 'prev')))?.value as GameEvent | undefined;
  const first = (await req(store('readonly').openCursor()))?.value as GameEvent | undefined;
  const sessionId = first?.session_id ?? crypto.randomUUID();
  let seq = last ? last.seq + 1 : 0;
  let db: Db | undefined;

  // One chain for appends and replay, so an event can't land between the replay
  // snapshot and the moment live mirroring starts.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };

  return {
    sessionId,
    all,
    append: (e) =>
      serial(async () => {
        const ev: GameEvent = {
          node: '', character: '', choice_id: '', choice_text: '', dialogue_text: '',
          affection_delta: 0, time_to_choose_ms: 0, route: '', attributes: {},
          ...e,
          event_id: crypto.randomUUID(),
          session_id: sessionId,
          ts: tsNow(),
          seq: seq,
        };
        await req(store('readwrite').add(ev)); // source of truth first; failure rejects the append
        seq++;
        // A failed mirror is repaired by the next replay, since the log already has the event.
        if (db) await db.insert('events', [ev]).catch((err) => console.error('[collector] mirror failed', err));
        return ev;
      }),
    attach: (target) =>
      serial(async () => {
        const evs = await all();
        for (let i = 0; i < evs.length; i += REPLAY_BATCH) await target.insert('events', evs.slice(i, i + REPLAY_BATCH));
        db = target;
        return evs.length;
      }),
    exportJsonl: async () => (await all()).map((e) => JSON.stringify(e)).join('\n'),
    replace: (events) =>
      serial(async () => {
        const tx = idb.transaction(STORE, 'readwrite');
        const s = tx.objectStore(STORE);
        s.clear();
        for (const e of events) s.add(e);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }),
  };
}
