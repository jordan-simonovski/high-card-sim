import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumePoint, type ResumeEvent } from './resume.ts';
import type { Scene } from './scene.ts';

const scenes: Record<string, Scene> = {
  a: {
    id: 'a', start: 'one',
    nodes: {
      one: { id: 'one', text: 'hi', next: 'pick' },
      pick: { id: 'pick', text: 'pick', choices: [{ id: 'x', text: 'x', target: 'two' }, { id: 'y', text: 'y', target: '@b' }] },
      two: { id: 'two', text: 'two' },
      make: { id: 'make', text: '', action: 'create_character', next: 'two' },
    },
  },
  b: { id: 'b', start: 'begin', nodes: { begin: { id: 'begin', text: 'b', ending: 'Fin' } } },
};
const ev = (event_type: string, scene: string, node: string, choice_id = ''): ResumeEvent => ({ event_type, scene, node, choice_id });

test('resume after a line shows it again without logging', () => {
  assert.deepEqual(resumePoint([ev('scene_enter', 'a', 'one'), ev('line', 'a', 'one')], scenes), { scene: 'a', node: 'one', shown: true });
});

test('resume after a choice goes to its target, across scenes too', () => {
  assert.deepEqual(resumePoint([ev('line', 'a', 'pick'), ev('choice', 'a', 'pick', 'x')], scenes), { scene: 'a', node: 'two', shown: false });
  assert.deepEqual(resumePoint([ev('choice', 'a', 'pick', 'y')], scenes), { scene: 'b', node: 'begin', shown: false });
});

test('character creation resumes after the form; endings and unknown content do not resume', () => {
  assert.deepEqual(resumePoint([ev('character_created', 'a', 'make')], scenes), { scene: 'a', node: 'two', shown: false });
  assert.equal(resumePoint([ev('ending', 'b', 'begin')], scenes), undefined);
  assert.equal(resumePoint([ev('line', 'gone', 'x')], scenes), undefined);
  assert.equal(resumePoint([ev('query_run', 'a', 'one')], scenes), undefined);
  assert.equal(resumePoint([], scenes), undefined);
});
