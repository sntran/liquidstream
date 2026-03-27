import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { caseTag, elseTag, elsif, ifTag, when } from "../lib/tags/flow.js";
import { coreTags } from "../lib/tags.js";
import { forTag, parseForExpression } from "../lib/tags/iteration.js";
import { OUTPUT, RESUME_EMIT, SKIP, applySignal } from "../lib/tags/signals.js";
import { assign, parseAssignExpression } from "../lib/tags/variable.js";

describe("tag modules", () => {
  it("exports the core tag registry", () => {
    assert.equal(coreTags.if, ifTag);
    assert.equal(coreTags.else, elseTag);
    assert.equal(coreTags.case, caseTag);
    assert.equal(coreTags.when, when);
    assert.equal(coreTags.for, forTag);
    assert.equal(coreTags.assign, assign);
  });

  it("keeps elsif from double-firing once a branch matched", async () => {
    const parentContext = { value: 1 };
    const handler = {
      state: "SKIP",
      skipDepth: 1,
      skipMode: "if_false",
      currentContext: parentContext,
      ifStack: [{
        type: "if",
        truthy: false,
        parentContext,
        branchContext: Object.create(parentContext),
      }],
    };

    const signal = await elsif.onSkip({
      expression: "value == 1",
      handler,
      evaluate: () => true,
    });

    assert.deepEqual(signal.action, RESUME_EMIT().action);
    applySignal(signal, handler);
    assert.equal(handler.state, "EMIT");
    assert.equal(handler.skipDepth, 0);
    assert.equal(handler.skipMode, null);
    assert.equal(handler.ifStack.at(-1).truthy, true);

    const secondSignal = await elsif.onSkip({
      expression: "value == 1",
      handler,
      evaluate: () => true,
    });

    assert.equal(secondSignal, null);
  });

  it("applies signal payloads to handler state", () => {
    const handler = {
      state: "EMIT",
      skipDepth: 0,
      skipMode: null,
      currentContext: {},
      ifStack: [],
      capture: null,
      raw: null,
    };

    applySignal(SKIP({ skipDepth: 2, skipMode: "if_false" }), handler);
    assert.equal(handler.state, "SKIP");
    assert.equal(handler.skipDepth, 2);
    assert.equal(handler.skipMode, "if_false");

    applySignal(RESUME_EMIT({ skipDepth: 0, skipMode: null }), handler);
    assert.equal(handler.state, "EMIT");

    const out = OUTPUT("value", { html: true });
    assert.equal(out.output, "value");
    assert.equal(out.html, true);
  });

  it("preserves the extracted parsing helpers", () => {
    assert.deepEqual(parseAssignExpression("assign total = 5"), {
      variableName: "total",
      valueExpression: "5",
    });

    assert.deepEqual(parseForExpression("for item in items limit:2 reversed"), {
      itemName: "item",
      collectionPath: "items",
      limitExpression: "2",
      offsetExpression: null,
      reversed: true,
    });
  });
});
