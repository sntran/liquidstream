import test from "node:test";
import assert from "node:assert/strict";
import { Liquid } from "../src/index.js";

test("large loops can yield between batches", async () => {
  class FakeTextNode {
    constructor(text) {
      this.text = text;
      this.lastInTextNode = true;
      this.value = text;
    }

    replace(value) {
      this.value = value;
    }
  }

  class FakeHTMLRewriter {
    on(_selector, handler) {
      this.handler = handler;
      return this;
    }

    transform(response) {
      return {
        text: async () => {
          const node = new FakeTextNode(await response.text());
          await this.handler.text(node);
          return node.value;
        },
      };
    }
  }

  let yields = 0;
  const engine = new Liquid({
    HTMLRewriterClass: FakeHTMLRewriter,
    yieldAfter: 2,
    yieldControl: async () => {
      yields += 1;
    },
  });

  assert.equal(
    await engine.parseAndRender('{% for i in list %}{{ i }}{% endfor %}', {
      list: [1, 2, 3, 4, 5],
    }),
    '12345',
  );
  assert.equal(yields, 2);
});
