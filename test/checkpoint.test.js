import test from "node:test";
import assert from "node:assert/strict";
import { Liquid } from "../src/index.js";

test("capture mode replays loop fragments", async () => {
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
          const text = await response.text();
          const node = new FakeTextNode(text);
          await this.handler.text(node);
          return node.value;
        },
      };
    }
  }

  const engine = new Liquid({ HTMLRewriterClass: FakeHTMLRewriter });
  assert.equal(
    await engine.parseAndRender('{% for i in list %}[{{ i }}]{% endfor %}', {
      list: [1, 2, 3],
    }),
    '[1][2][3]',
  );
});
