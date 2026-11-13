import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentRows, keptTraceRows, CARDINALITY_WARN, FAILING_REQUEST } from './incident.ts';

const sid = '6f1c2e9a-0000-4000-a000-000000000001';
const ts = '2026-11-13 03:12:00.000';

test('the incident is deterministic per session', () => {
  assert.deepEqual(incidentRows(sid, ts), incidentRows(sid, ts));
  assert.notDeepEqual(incidentRows(sid, ts)[0], incidentRows(sid.replace('1', '2'), ts)[0]);
});

test('the clues are there: the WARN, errors carried by OnlySpans, one subscriber per span', () => {
  const rows = incidentRows(sid, ts);
  assert.ok(rows.length > 2000);
  assert.ok(rows.every((r) => r.ts <= ts && r.scene === 'incident' && r.character === 'realm'));
  assert.ok(rows.filter((r) => r.dialogue_text.includes(CARDINALITY_WARN)).length >= 20);
  const errs = rows.filter((r) => r.attributes.status === 'error');
  const os = errs.filter((r) => r.attributes.tier === 'onlyspans').length;
  assert.ok(os / errs.length > 0.9, `onlyspans carries ${os}/${errs.length} errors`);
  const osSubs = new Set(rows.filter((r) => r.attributes.tier === 'onlyspans').map((r) => r.attributes.subscriber_id));
  const proSubs = new Set(rows.filter((r) => r.attributes.tier === 'pro').map((r) => r.attributes.subscriber_id));
  assert.ok(osSubs.size > 100 && proSubs.size <= 6);
  // Citizens being sampled out: free and pro traffic has stopped by the last two minutes.
  const quiet = (r: { ts: string; attributes: Record<string, string> }) => r.attributes.tier && r.attributes.tier !== 'onlyspans';
  assert.ok(rows.filter((r) => quiet(r) && r.ts < '2026-11-13 03:02').length > 50);
  assert.equal(rows.filter((r) => quiet(r) && r.ts >= '2026-11-13 03:10').length, 0);
});

test('the kept trace is a whole, tail-sampled path that dies in the batch processor', () => {
  const spans = keptTraceRows(sid, ts);
  assert.ok(spans.every((s) => s.attributes['sampling.priority'] === '1' && s.attributes.request === FAILING_REQUEST));
  assert.equal(spans[0].attributes.parent_span_id, '');
  for (let i = 1; i < spans.length; i++) assert.equal(spans[i].attributes.parent_span_id, spans[i - 1].attributes.span_id);
  const last = spans.at(-1)!;
  assert.equal(last.node, 'collector.batch_processor');
  assert.equal(last.attributes.status, 'error');
});
