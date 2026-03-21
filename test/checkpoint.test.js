import test from "node:test";
import assert from "node:assert/strict";
import { parsePathSegments, resolvePathValue, splitTopLevel } from "../src/index.js";

test("commit 1 tokenizer helpers", () => {
  assert.deepEqual(splitTopLevel('"a:b":c', ':'), ['"a:b"', 'c']);
  assert.deepEqual(parsePathSegments('user.profile.name'), ['user', 'profile', 'name']);
  assert.equal(resolvePathValue({ name: 'Ada' }, 'name'), 'Ada');
});
