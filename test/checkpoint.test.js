import test from "node:test";
import assert from "node:assert/strict";
import { Liquid } from "../src/index.js";

test("shared filters can be extended per instance", async () => {
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

  const engine = new Liquid({ HTMLRewriterClass: FakeHTMLRewriter });
  engine.registerFilter('surround', (value) => `[${value}]`);

  assert.equal(
    await engine.parseAndRender('{{ word | downcase | capitalize | default: "x" }}', {
      word: 'HELLO',
    }),
    'hello',
  );
  assert.equal(
    await engine.parseAndRender('{{ word | surround }}', { word: 'Ada' }),
    '[Ada]',
  );
});
