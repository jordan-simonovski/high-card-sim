import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsQueries, nextNode, node, visibleChoices, type Conditions, type Scene } from './scene.ts';

const scene: Scene = {
  id: 'date_traces',
  start: 'arrive',
  nodes: {
    arrive: { id: 'arrive', speaker: 'traces', text: 'Oh! You actually sampled me in.', next: 'check' },
    check: {
      id: 'check',
      text: '',
      branches: [
        { condition: 'traces_trusts_you', target: 'open_up' },
        { condition: 'traces_seen_before', target: 'awkward' },
      ],
      next: 'dropped',
    },
    open_up: {
      id: 'open_up',
      speaker: 'traces',
      text: 'Want to see my whole span tree?',
      choices: [
        { id: 'yes', text: 'Show me everything.', target: 'end', affection_delta: 2 },
        { id: 'secret', text: 'Query the base table.', target: 'polycule', condition: 'queried_base_table' },
      ],
    },
    awkward: { id: 'awkward', text: '...', next: 'end' },
    dropped: { id: 'dropped', text: 'They were sampled out.' },
    end: { id: 'end', text: 'fin' },
    polycule: { id: 'polycule', text: 'Stop sampling yourself.' },
  },
};

/** Fake query layer: named query -> boolean, records call order. */
function fake(truthy: Record<string, boolean>) {
  const calls: string[] = [];
  const cond: Conditions = async (q) => {
    calls.push(q);
    if (!(q in truthy)) throw new Error(`unexpected query ${q}`);
    return truthy[q];
  };
  return { cond, calls };
}

test('linear nodes follow next and need no queries', async () => {
  const { cond, calls } = fake({});
  assert.equal(needsQueries(node(scene, 'arrive')), false);
  assert.equal(await nextNode(node(scene, 'arrive'), cond), 'check');
  assert.deepEqual(calls, []);
});

test('branches: first truthy wins, evaluated in order, short-circuit', async () => {
  const a = fake({ traces_trusts_you: false, traces_seen_before: true });
  assert.equal(await nextNode(node(scene, 'check'), a.cond), 'awkward');
  assert.deepEqual(a.calls, ['traces_trusts_you', 'traces_seen_before']);

  const b = fake({ traces_trusts_you: true });
  assert.equal(await nextNode(node(scene, 'check'), b.cond), 'open_up');
  assert.deepEqual(b.calls, ['traces_trusts_you']);
});

test('branches fall back to next when nothing matches', async () => {
  const { cond } = fake({ traces_trusts_you: false, traces_seen_before: false });
  assert.equal(await nextNode(node(scene, 'check'), cond), 'dropped');
  assert.equal(await nextNode(node(scene, 'dropped'), cond), undefined);
});

test('conditional choices are hidden until their query is truthy', async () => {
  const n = node(scene, 'open_up');
  assert.equal(needsQueries(n), true);
  assert.deepEqual((await visibleChoices(n, fake({ queried_base_table: false }).cond)).map((c) => c.id), ['yes']);
  assert.deepEqual((await visibleChoices(n, fake({ queried_base_table: true }).cond)).map((c) => c.id), ['yes', 'secret']);
});

test('choosing resolves the target; unknown choices throw', async () => {
  const n = node(scene, 'open_up');
  const { cond } = fake({});
  assert.equal(await nextNode(n, cond, 'yes'), 'end');
  await assert.rejects(nextNode(n, cond, 'nope'));
  await assert.rejects(nextNode(n, cond));
  assert.throws(() => node(scene, 'missing'));
});
