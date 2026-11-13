import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeParamValue, paramStatements, quoteString } from './sql.ts';

test('quoteString escapes backslash before quote', () => {
  assert.equal(quoteString("O'Brien"), "'O\\'Brien'");
  assert.equal(quoteString('a\\b'), "'a\\\\b'");
  // A trailing backslash must not escape the closing quote.
  assert.equal(quoteString("x\\"), "'x\\\\'");
  assert.equal(quoteString("\\'; DROP TABLE events; --"), "'\\\\\\'; DROP TABLE events; --'");
});

test('paramStatements rejects unsafe names and non-finite numbers', () => {
  assert.deepEqual(paramStatements({ name: 'Ada', n: 3 }), ["SET param_name = 'Ada'", "SET param_n = '3'"]);
  assert.throws(() => paramStatements({ 'x = 1; DROP': 'v' }));
  assert.throws(() => paramStatements({ n: Number.NaN }));
});

test('param values are TSV-escaped, then quoted', () => {
  assert.equal(escapeParamValue('a\\b\tc\nd'), 'a\\\\b\\tc\\nd');
  // trailing backslash: TSV-escaped to two, then each doubled again for the literal
  assert.deepEqual(paramStatements({ v: 'x\\' }), ["SET param_v = 'x\\\\\\\\'"]);
});
