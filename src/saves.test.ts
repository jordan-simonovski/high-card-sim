import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSave } from './saves.ts';

const ev = (seq: number, over: Record<string, unknown> = {}) => ({
  event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
  session_id: '11111111-1111-4111-8111-111111111111',
  ts: '2026-11-13 03:12:00.000', seq, scene: 'prologue', node: 'ceiling', event_type: 'line',
  character: '', choice_id: '', choice_text: '', dialogue_text: 'hi', affection_delta: 0,
  time_to_choose_ms: 0, route: '', attributes: { 'player.name': "x'); DROP TABLE events; --" }, ...over,
});
const save = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join('\n');

test('a valid save round-trips, sorted by seq, hostile strings kept as data', () => {
  const out = parseSave(save(ev(1), ev(0)));
  assert.deepEqual(out.map((e) => e.seq), [0, 1]);
  assert.equal(out[0].attributes['player.name'], "x'); DROP TABLE events; --");
});

test('rejects malformed saves with a line number', () => {
  assert.throws(() => parseSave(''), /empty/);
  assert.throws(() => parseSave('nope'), /line 1: not JSON/);
  assert.throws(() => parseSave(save(ev(0), ev(1, { seq: 'x' }))), /line 2: seq/);
  assert.throws(() => parseSave(save(ev(0, { event_id: 'not-a-uuid' }))), /bad uuid/);
  assert.throws(() => parseSave(save(ev(0, { ts: 'yesterday' }))), /bad ts/);
  assert.throws(() => parseSave(save(ev(0, { attributes: { a: 1 } }))), /attributes\.a must be a string/);
  assert.throws(() => parseSave(save(ev(0), ev(0))), /duplicate seq/);
  assert.throws(() => parseSave(save(ev(0), ev(1, { session_id: '22222222-2222-4222-8222-222222222222' }))), /exactly one session/);
  assert.throws(() => parseSave(save(ev(0, { dialogue_text: 'x'.repeat(10_001) }))), /too long/);
});
