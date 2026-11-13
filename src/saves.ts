// Save files are the event log as JSONEachRow. Import is a trust boundary: someone else's
// playthrough can be anything, so every field is checked and normalised before it goes
// into IndexedDB (and from there into chDB, via JSONEachRow data, never SQL text).
import type { GameEvent } from './eventlog.ts';

export const MAX_SAVE_BYTES = 20 * 1024 * 1024;
export const MAX_EVENTS = 100_000;
const MAX_STR = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

const STRINGS = ['scene', 'node', 'event_type', 'character', 'choice_id', 'choice_text', 'dialogue_text', 'route'] as const;

function str(v: unknown, field: string, line: number): string {
  if (typeof v !== 'string') throw new Error(`line ${line}: ${field} must be a string`);
  if (v.length > MAX_STR) throw new Error(`line ${line}: ${field} is too long`);
  return v;
}

function int(v: unknown, field: string, line: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`line ${line}: ${field} out of range`);
  return v;
}

/** Parse and validate a save. Throws with a line number on the first problem. */
export function parseSave(text: string): GameEvent[] {
  if (text.length > MAX_SAVE_BYTES) throw new Error('save file is too large');
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) throw new Error('save file is empty');
  if (lines.length > MAX_EVENTS) throw new Error('save file has too many events');
  const events = lines.map((l, i): GameEvent => {
    const line = i + 1;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(l);
    } catch {
      throw new Error(`line ${line}: not JSON`);
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`line ${line}: not an object`);
    const e = {
      event_id: str(o.event_id, 'event_id', line),
      session_id: str(o.session_id, 'session_id', line),
      ts: str(o.ts, 'ts', line),
      seq: int(o.seq, 'seq', line, 0, MAX_EVENTS * 10),
      affection_delta: int(o.affection_delta, 'affection_delta', line, -1000, 1000),
      time_to_choose_ms: int(o.time_to_choose_ms, 'time_to_choose_ms', line, 0, 2 ** 32 - 1),
      attributes: {} as Record<string, string>,
    } as GameEvent;
    for (const f of STRINGS) e[f] = str(o[f], f, line);
    if (!UUID.test(e.event_id) || !UUID.test(e.session_id)) throw new Error(`line ${line}: bad uuid`);
    if (!TS.test(e.ts)) throw new Error(`line ${line}: bad ts`);
    const attrs = o.attributes ?? {};
    if (typeof attrs !== 'object' || Array.isArray(attrs)) throw new Error(`line ${line}: attributes must be an object`);
    for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) e.attributes[str(k, 'attribute key', line)] = str(v, `attributes.${k}`, line);
    return e;
  });
  const seqs = new Set(events.map((e) => e.seq));
  if (seqs.size !== events.length) throw new Error('duplicate seq values');
  if (new Set(events.map((e) => e.session_id)).size !== 1) throw new Error('a save holds exactly one session');
  return events.sort((a, b) => a.seq - b.seq);
}
