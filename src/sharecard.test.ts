import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statLines } from './sharecard.ts';

test('the share card reads its lines from the stats row', () => {
  const lines = statLines({
    moments: '400', queries: 12, median_ms: 2400, slowest_ms: 9200, slowest_choice: '"Take their hand anyway. It won\'t be kept, but you would like to have had it."',
    resolved: 1, resolve_s: 760, logs_lines: 61, metrics_sum: 5, traces_kept: 9,
  });
  assert.deepEqual(lines.slice(0, 3), [
    'Sev-1 resolved in 12m 40s',
    'Traces kept 9 of 400 moments (2.3%)',
    'Logs wrote down 61 lines. Metrics kept one number: +5',
  ]);
  assert.match(lines[3], /^Slowest decision: 9\.2 s, over “Take their hand anyway.*…”$/);
  assert.equal(lines[4], '12 queries run. Median decision: 2.4 s');
  // No incident, nothing chosen: those lines drop out rather than print zeroes.
  assert.equal(statLines({ moments: 3, metrics_sum: -2 }).length, 3);
});
