import test from "node:test";
import assert from "node:assert/strict";
import { Liquid } from "../src/index.js";

test("rewriter buffers split text nodes before interpolation", async () => {
  class FakeTextNode {
    constructor(text, lastInTextNode) {
      this.text = text;
      this.lastInTextNode = lastInTextNode;
      this.value = text;
    }

    remove() {
      this.value = "";
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
          await response.text();
          const first = new FakeTextNode('{{ user.', false);
          const second = new FakeTextNode('name }}', true);
          this.handler.text(first);
          this.handler.text(second);
          return `${first.value}${second.value}`;
        },
      };
    }
  }

  const engine = new Liquid({ HTMLRewriterClass: FakeHTMLRewriter });
  assert.equal(
    await engine.parseAndRender('<p>{{ user.name }}</p>', { user: { name: 'Ada' } }),
    'Ada',
  );
});
