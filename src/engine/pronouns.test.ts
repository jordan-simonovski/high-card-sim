import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, render, type Player } from './pronouns.ts';

const characters = { logs: PRESETS.she, metrics: PRESETS.he, traces: PRESETS.they };
const kit: Player = { name: 'Kit' };
const r = (text: string, player: Player | undefined = kit) => render(text, { player, characters });

test('the player is addressed by name; NPCs use their own pronouns and agreement', () => {
  assert.equal(r('Hi {name}. {logs.She} [logs:is|are] verbose; {metrics.he} [metrics:is|are] not; {traces.They} [traces:is|are] sampled.'),
    'Hi Kit. She is verbose; he is not; They are sampled.');
  assert.equal(r('{logs.their} logs, {metrics.his} counters'), 'her logs, his counters');
});

test('player pronoun tokens and player verb agreement no longer exist', () => {
  assert.throws(() => r('{they} waved'), /the player has no pronouns/);
  assert.throws(() => r('{gender}'), /the player has no pronouns/);
  assert.throws(() => r('[is|are]'), /verb agreement needs a character/);
});

test('errors: name before creation, unknown characters and forms', () => {
  assert.throws(() => render('{name}', { characters }), /before character creation/);
  assert.throws(() => r('{nobody.they}'), /unknown character/);
  assert.throws(() => r('{logs.zz}'), /unknown pronoun form/);
});

test('player-entered text is inserted literally, never re-parsed as tokens', () => {
  assert.equal(r('Hi {name}.', { name: '{logs.she} [logs:is|are]' }), 'Hi {logs.she} [logs:is|are].');
});
