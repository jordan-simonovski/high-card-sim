import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkText, validate, type Content } from './validate.ts';
import type { Scene } from './scene.ts';

const characters = { logs: { name: 'Logs', pronouns: 'she' }, dba: { name: 'The DBA', pronouns: 'they' } };
const base = (nodes: Scene['nodes'], extra: Partial<Content> = {}): Content => ({
  scenes: [{ id: 'prologue', start: 'a', nodes }],
  queries: ['trusts_you'],
  characters,
  presets: ['she', 'he', 'they'],
  ...extra,
});

test('hardcoded pronouns fail; NPC tokens and {name} pass', () => {
  assert.match(checkText('She smiles at you.', characters).errors[0], /hardcoded pronoun "She"/);
  assert.match(checkText('Tell him the pager is his.', characters).errors[0], /hardcoded pronoun "him"/);
  assert.deepEqual(checkText('{logs.She} smiles. [logs:Is|Are] that you, {name}?', characters).errors, []);
  // Words that merely contain pronouns are fine.
  assert.deepEqual(checkText('The shell where the theme is, there and here.', characters).errors, []);
});

test('token errors: unknown tokens, characters, forms, contractions', () => {
  const errs = (t: string) => checkText(t, characters).errors.join('\n');
  assert.match(errs('{she} waves'), /the player has no pronouns/);
  assert.match(errs('{They} [is|are] here'), /the player has no pronouns/);
  assert.match(errs('[is|are]'), /verb agreement needs a character/);
  assert.match(errs('{ghost.they}'), /unknown character/);
  assert.match(errs('{logs.zz}'), /unknown pronoun form/);
  assert.match(errs("{logs.she}'s late"), /contraction/);
  assert.match(errs('[ghost:is|are]'), /unknown character/);
  assert.equal(checkText("{name}'s pager", characters).errors.length, 0);
});

test('graph checks: targets, queries, reachability, speakers, choices', () => {
  const errors = validate(
    base({
      a: { id: 'a', speaker: 'ghost', text: 'hi', next: 'missing' },
      b: { id: 'b', text: 'orphan', ending: 'The End' },
      c: {
        id: 'c', text: 'pick',
        choices: [
          { id: 'x', text: 'one', target: 'a', condition: 'nope' },
          { id: 'x', text: '', target: '' },
        ],
      },
    }),
  ).join('\n');
  for (const want of [/unknown speaker "ghost"/, /target "missing" does not exist/, /prologue\/b: unreachable/, /unknown query "nope"/, /duplicate choice id "x"/, /has no target/, /has no text/])
    assert.match(errors, want);
});

test('player tokens before character creation are rejected', () => {
  const errors = validate(
    base({
      a: { id: 'a', text: 'Hello {name}', next: 'create' },
      create: { id: 'create', text: '', action: 'create_character', next: 'after' },
      after: { id: 'after', text: '{name} is indexed.', ending: 'Indexed' },
    }),
  );
  assert.deepEqual(errors, ['prologue/a: uses player tokens before character creation']);
});

test('a clean scene validates', () => {
  assert.deepEqual(
    validate(base({
      a: { id: 'a', speaker: 'logs', text: '{logs.She} talks.', branches: [{ condition: 'trusts_you', target: 'b' }], next: 'b' },
      b: { id: 'b', text: 'fin', ending: 'Fin' },
    })),
    [],
  );
});

test('scene jumps, endings, dead ends, show queries, attributes', () => {
  const content: Content = {
    ...base({}),
    scenes: [
      { id: 'prologue', start: 'a', nodes: {
        a: { id: 'a', text: 'go', show: 'nope', choices: [
          { id: 'h', text: 'hub', target: '@hub', attributes: { 'sampling.priority': '1' } },
          { id: 'g', text: 'ghost', target: '@ghost', attributes: { Bad: '1' } },
        ] },
      } },
      { id: 'hub', start: 'h', nodes: { h: { id: 'h', text: 'stuck' }, e: { id: 'e', text: 'x', ending: '', next: 'h' } } },
      { id: 'island', start: 'i', nodes: { i: { id: 'i', text: 'i', ending: 'Alone' } } },
    ],
  };
  const errors = validate(content).join('\n');
  for (const want of [/scene "ghost" does not exist/, /unknown query "nope" in show/, /attribute Bad/, /hub\/h: dead end/, /hub\/e: an ending needs/, /island: scene is unreachable/])
    assert.match(errors, want);
  assert.doesNotMatch(errors, /sampling\.priority/);
});
