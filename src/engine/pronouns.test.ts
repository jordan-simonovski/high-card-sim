import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, pronounLabel, render, setFor, type Player } from './pronouns.ts';

const characters = { logs: PRESETS.she, metrics: PRESETS.he, traces: PRESETS.they };
const r = (text: string, player?: Player, lineKey = 'k') => render(text, { player, characters, lineKey });

test('player forms, capitalisation and verb agreement', () => {
  const ada: Player = { name: 'Ada', gender: 'woman', pronouns: [PRESETS.she] };
  assert.equal(r('{They} [is|are] here. Tell {them} {their} pager is {theirs} to fix {themself}.', ada),
    'She is here. Tell her her pager is hers to fix herself.');
  const sam: Player = { name: 'Sam', gender: 'nonbinary', pronouns: [PRESETS.they] };
  assert.equal(r('{They} [is|are] here.', sam), 'They are here.');
  const xe: Player = { name: 'Rin', gender: '', pronouns: [PRESETS.xe] };
  assert.equal(r('{They} [has|have] {their} own cardinality.', xe), 'Xe has xyr own cardinality.');
});

test('custom sets and name-only players', () => {
  const custom: Player = {
    name: 'Bo', gender: 'demigirl',
    pronouns: [{ they: 'fae', them: 'faer', their: 'faer', theirs: 'faers', themself: 'faeself', plural: false }],
  };
  assert.equal(r('{They} [is|are] {gender}; ask {them}.', custom), 'Fae is demigirl; ask faer.');
  const nameOnly: Player = { name: 'Kit', gender: '', pronouns: [] };
  assert.equal(r('{They} [is|are] late; {their} pager rang.', nameOnly), 'Kit is late; Kit’s pager rang.');
  assert.equal(pronounLabel(nameOnly), 'name only');
});

test('multiple sets rotate deterministically per line, consistent within a line', () => {
  const p: Player = { name: 'Jo', gender: '', pronouns: [PRESETS.she, PRESETS.they] };
  const seen = new Set<string>();
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const out = r('{They} [is|are]', p, k);
    assert.ok(out === 'She is' || out === 'They are', out); // never "She are"
    assert.equal(r('{They} [is|are]', p, k), out); // stable for the same line
    seen.add(out);
  }
  assert.equal(seen.size, 2);
  assert.equal(setFor(p, 'a'), setFor(p, 'a'));
  assert.equal(pronounLabel(p), 'she/they');
});

test('NPC tokens use the character registry', () => {
  assert.equal(r('{logs.She} [logs:is|are] verbose; {metrics.he} [metrics:is|are] not; {traces.They} [traces:is|are] sampled.'),
    'She is verbose; he is not; They are sampled.');
  assert.equal(r('{logs.their} logs'), 'her logs');
});

test('errors: player tokens before creation, unknown tokens and characters', () => {
  assert.throws(() => r('{they}'), /before character creation/);
  const p: Player = { name: 'A', gender: '', pronouns: [PRESETS.they] };
  assert.throws(() => r('{she}', p), /unknown token/);
  assert.throws(() => r('{nobody.they}', p), /unknown character/);
  assert.throws(() => r('{logs.zz}', p), /unknown pronoun form/);
});

test('player-entered text is inserted literally, never re-parsed as tokens', () => {
  const p: Player = { name: '{they} [is|are] {logs.she}', gender: '{them}', pronouns: [PRESETS.they] };
  assert.equal(r('Hi {name} ({gender}), {they} [is|are] here.', p), 'Hi {they} [is|are] {logs.she} ({them}), they are here.');
});
