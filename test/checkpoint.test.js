import test from "node:test";
import assert from "node:assert/strict";
import {
  Liquid,
  parsePathSegments,
  resolvePathValue,
  splitTopLevel,
} from "../src/index.js";

test("expression resolver stays pure", () => {
  const engine = new Liquid();

  assert.deepEqual(splitTopLevel('"a:b":c', ':'), ['"a:b"', 'c']);
  assert.deepEqual(parsePathSegments('user.profile.name'), [
    'user',
    'profile',
    'name',
  ]);
  assert.equal(resolvePathValue({ name: 'Ada' }, 'name'), 'Ada');
  assert.equal(engine.resolveExpression('"Ada"'), 'Ada');
  assert.equal(engine.resolveValue('user.name', { user: { name: 'Ada' } }), 'Ada');
});
