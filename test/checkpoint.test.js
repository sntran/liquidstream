import test from "node:test";
import assert from "node:assert/strict";
import { Liquid } from "../src/index.js";

test("emit and skip states gate block output", async () => {
  const engine = new Liquid();

  assert.equal(
    await engine.parseAndRender(
      '{% assign label = "ok" %}{% if label %}<p>{{ label | upcase }}</p>{% endif %}',
    ),
    '<p>OK</p>',
  );
});
