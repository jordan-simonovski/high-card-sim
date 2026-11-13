import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText, validate, type Content } from './validate.ts';
import type { Scene } from './scene.ts';

const characters = { logs: { name: 'Logs', pronouns: 'she' }, dba: { name: 'The DBA', pronouns: 'they' } };
const base = (nodes: Scene['nodes'], extra: Partial<Content> = {}): Content => ({
  scenes: [{ id: 's', start: 'a', nodes }],
  queries: ['trusts_you'],
  characters,
  presets: ['she', 'he', 'they'],
  ...extra,
});

test('hardcoded player pronouns fail; tokens and NPC tokens pass', () => {
  assert.match(checkText('She smiles at you.', characters).errors[0], /hardcoded pronoun "She"/);
  assert.match(checkText('Tell him the pager is his.', characters).errors[0], /hardcoded pronoun "him"/);
  assert.deepEqual(checkText('{logs.She} smiles. {They} [is|are] here, {name}.', characters).errors, []);
  // Words that merely contain pronouns are fine.
  assert.deepEqual(checkText('The shell where the theme is, there and here.', characters).errors, []);
});

test('token errors: unknown tokens, characters, forms, contractions', () => {
  const errs = (t: string) => checkText(t, characters).errors.join('\n');
  assert.match(errs('{she} waves'), /unknown token \{she\}/);
  assert.match(errs('{ghost.they}'), /unknown character/);
  assert.match(errs('{logs.zz}'), /unknown pronoun form/);
  assert.match(errs("{they}'re late"), /contraction/);
  assert.match(errs('[ghost:is|are]'), /unknown character/);
  assert.equal(checkText("{name}'s pager", characters).errors.length, 0);
});

test('graph checks: targets, queries, reachability, speakers, choices', () => {
  const errors = validate(
    base({
      a: { id: 'a', speaker: 'ghost', text: 'hi', next: 'missing' },
      b: { id: 'b', text: 'orphan' },
      c: {
        id: 'c', text: 'pick',
        choices: [
          { id: 'x', text: 'one', target: 'a', condition: 'nope' },
          { id: 'x', text: '', target: '' },
        ],
      },
    }),
  ).join('\n');
  for (const want of [/unknown speaker "ghost"/, /target "missing" does not exist/, /s\/b: unreachable/, /unknown query "nope"/, /duplicate choice id "x"/, /has no target/, /has no text/])
    assert.match(errors, want);
});

test('player tokens before character creation are rejected', () => {
  const errors = validate(
    base({
      a: { id: 'a', text: 'Hello {name}', next: 'create' },
      create: { id: 'create', text: '', action: 'create_character', next: 'after' },
      after: { id: 'after', text: '{They} [is|are] indexed.' },
    }),
  );
  assert.deepEqual(errors, ['s/a: uses player tokens before character creation']);
});

test('a clean scene validates', () => {
  assert.deepEqual(
    validate(base({
      a: { id: 'a', speaker: 'logs', text: '{logs.She} talks.', branches: [{ condition: 'trusts_you', target: 'b' }], next: 'b' },
      b: { id: 'b', text: 'fin' },
    })),
    [],
  );
});
