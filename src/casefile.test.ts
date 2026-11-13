import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseFile } from './casefile.ts';
import type { GameEvent } from './eventlog.ts';

const ev = (event_type: string, scene = '', node = '') => ({ event_type, scene, node }) as GameEvent;

test('the case file follows the investigation from the log', () => {
  assert.equal(caseFile([]).active, false);

  const started = [ev('incident_started', 'incident', 'alarm')];
  let cf = caseFile(started);
  assert.ok(cf.active);
  assert.equal(cf.current?.id, 'logs');
  assert.deepEqual(cf.leads.map((l) => l.state), ['current', 'locked', 'locked', 'locked']);
  assert.equal(cf.labelBack, false);

  const logsDone = [...started, ev('line', 'phase_logs', 'source'), ev('line', 'phase_metrics', 'add')];
  cf = caseFile(logsDone);
  assert.equal(cf.current?.id, 'metrics');
  assert.ok(cf.labelBack);

  cf = caseFile([...logsDone, ev('line', 'phase_metrics', 'clue'), ev('line', 'phase_traces', 'every_span'), ev('line', 'root_cause', 'explain'), ev('incident_resolved')]);
  assert.equal(cf.active, false);
  assert.ok(cf.resolved);
  assert.equal(cf.current, undefined);
  assert.ok(cf.leads.every((l) => l.state === 'found'));
});
