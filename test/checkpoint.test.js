import test from "node:test";
import assert from "node:assert/strict";
import { Liquid, escapeHtml } from "../src/index.js";

test("string interpolation renders variables and filters", async () => {
  const engine = new Liquid();

  assert.equal(escapeHtml('<Ada>'), '&lt;Ada&gt;');
  assert.equal(
    await engine.parseAndRender('<p>{{ user.name | upcase }}</p>', {
      user: { name: 'Ada' },
    }),
    '<p>ADA</p>',
  );
});
