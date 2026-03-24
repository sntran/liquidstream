import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid } from "../src/index.js";

describe("Liquid Logic Parity", () => {
  it("supports case/when/else branches", async () => {
    const engine = new Liquid();

    const matched = await engine.parseAndRender(
      '{% assign kind = "b" %}{% case kind %}{% when "a" %}A{% when "b" %}{% if true %}B{% endif %}{% else %}C{% endcase %}',
      {},
    );
    const fallback = await engine.parseAndRender(
      '{% assign kind = "z" %}{% case kind %}{% when "a" %}A{% else %}C{% endcase %}',
      {},
    );

    assert.equal(matched, "B");
    assert.equal(fallback, "C");
  });

  it("supports raw blocks without evaluating Liquid markup", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      '{% raw %}<p>{{ value }}</p>{% endraw %}',
      { value: "FAIL" },
    );

    assert.equal(html, "<p>{{ value }}</p>");
  });

  it("supports raw blocks across nested HTML elements", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% raw %}<section><em>{{ value }}</em></section>{% endraw %}",
      { value: "FAIL" },
    );

    assert.equal(html, "<section><em>{{ value }}</em></section>");
  });

  it("injects forloop metadata into loop scope", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% for item in list %}[{{ forloop.index }}|{{ forloop.index0 }}|{{ forloop.first }}|{{ forloop.last }}|{{ forloop.length }}|{{ item }}]{% endfor %}",
      { list: ["a", "b", "c"] },
    );

    assert.equal(html, "[1|0|true|false|3|a][2|1|false|false|3|b][3|2|false|true|3|c]");
  });

  it("supports numeric and variable-based range expressions", async () => {
    const engine = new Liquid();

    const numeric = await engine.parseAndRender(
      "{% for i in (1..3) %}{{ i }}{% endfor %}",
      {},
    );
    const variables = await engine.parseAndRender(
      "{% assign start = 2 %}{% assign finish = 4 %}{% for i in (start..finish) %}{{ i }}{% endfor %}",
      {},
    );

    assert.equal(numeric, "123");
    assert.equal(variables, "234");
  });

  it("supports increment and decrement counters across the render", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% increment counter %},{% increment counter %},{% decrement total %},{% decrement total %}",
      {},
    );

    assert.equal(html, "0,1,-1,-2");
  });

  it("supports array and object literals in expressions", async () => {
    const engine = new Liquid();

    const arrayHtml = await engine.parseAndRender(
      '{% assign colors = ["red", "blue"] %}{{ colors | join: "," }}',
      {},
    );
    const objectHtml = await engine.parseAndRender(
      '{% assign person = {"name": "Ada", "role": "dev"} %}{{ person.name }}-{{ person.role }}',
      {},
    );

    assert.equal(arrayHtml, "red,blue");
    assert.equal(objectHtml, "Ada-dev");
  });

  it("supports comparison operators and boolean chaining", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% if a >= 2 and b < 3 or c != 4 %}T{% else %}F{% endif %}|{% if n <= 5 and n > 1 %}Y{% else %}N{% endif %}",
      { a: 2, b: 2, c: 4, n: 3 },
    );

    assert.equal(html, "T|Y");
  });

  it("supports loop limit, offset, and reversed controls", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% for i in list limit:2 offset:1 reversed %}[{{ i }}]{% endfor %}",
      { list: [1, 2, 3, 4] },
    );

    assert.equal(html, "[3][2]");
  });

  it("covers direct case state transitions in emit and skip modes", async () => {
    const engine = new Liquid();

    const matchedState = {
      state: "EMIT",
      currentContext: {},
      textBufferParts: [],
      ifStack: [{ type: "case", matched: true, parentContext: {}, branchContext: {} }],
      skipDepth: 0,
      skipMode: null,
      capture: null,
      raw: null,
      runtime: { counters: Object.create(null) },
    };
    const matchedOutput = await engine.processEmitText('{% when "b" %}ignored{% endcase %}', matchedState);

    const unmatchedState = {
      state: "EMIT",
      currentContext: {},
      textBufferParts: [],
      ifStack: [{ type: "case", matched: false, parentContext: {}, branchContext: null }],
      skipDepth: 0,
      skipMode: null,
      capture: null,
      raw: null,
      runtime: { counters: Object.create(null) },
    };
    const elseOutput = await engine.processEmitText("{% else %}fallback", unmatchedState);

    const skipState = {
      state: "SKIP",
      currentContext: {},
      textBufferParts: [],
      ifStack: [{ type: "case", matched: true, parentContext: {}, branchContext: {} }],
      skipDepth: 1,
      skipMode: "case_search",
      capture: null,
      raw: null,
      runtime: { counters: Object.create(null) },
    };
    const skippedElse = engine.processSkipText("{% else %}", skipState);
    const strayWhen = await engine.processEmitText('{% when "x" %}still-here', {
      state: "EMIT",
      currentContext: {},
      textBufferParts: [],
      ifStack: [],
      skipDepth: 0,
      skipMode: null,
      capture: null,
      raw: null,
      runtime: { counters: Object.create(null) },
    });

    assert.equal(matchedOutput, "");
    assert.equal(elseOutput, "fallback");
    assert.equal(skippedElse, "");
    assert.equal(strayWhen, "still-here");
    assert.equal(unmatchedState.currentContext !== null, true);
  });

  it("preserves malformed raw blocks and raw inner block tags literally", async () => {
    const engine = new Liquid();
    const handler = {
      state: "RAW",
      currentContext: {},
      textBufferParts: [],
      ifStack: [],
      skipDepth: 0,
      skipMode: null,
      capture: null,
      raw: { bufferParts: [] },
      runtime: { counters: Object.create(null) },
    };

    const malformed = await engine.processRawText("{% if", handler);

    const rendered = await engine.parseAndRender(
      "{% raw %}{% if condition %}literal{% endraw %}",
      { condition: true },
    );

    assert.equal(malformed, "");
    assert.equal(handler.raw.bufferParts.join(""), "{% if");
    assert.equal(rendered, "{% if condition %}literal");
  });

  it("outputs raw block content verbatim between normal interpolations", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "Normal {{ var }} {% raw %}{{ hidden }}{% endraw %} Back",
      { var: "value", hidden: "FAIL" },
    );

    assert.equal(html, "Normal value {{ hidden }} Back");
  });

  it("suppresses block tags inside raw blocks, outputting them as plain text", async () => {
    const engine = new Liquid();

    const html = await engine.parseAndRender(
      "{% raw %}{% assign x = 1 %}{% endraw %}",
      {},
    );

    assert.equal(html, "{% assign x = 1 %}");
  });

  it("preserves STATE_RAW across renderFragment calls with no leakage", async () => {
    const engine = new Liquid();

    // Confirm the assign is NOT executed — title stays undefined after the raw block.
    // Raw block content is output verbatim (no HTML-escaping), so single quotes
    // remain as literal characters rather than being encoded as &#39;
    const html = await engine.parseAndRender(
      "{% raw %}{% assign title = 'secret' %}{% endraw %}{{ title }}",
      {},
    );

    // Literal tag text is emitted; title is never assigned so {{ title }} is empty
    assert.equal(html, "{% assign title = 'secret' %}");
  });

  it("handles malformed counter expressions and invalid ranges defensively", async () => {
    const engine = new Liquid();

    const malformedCounter = await engine.processEmitText("{% increment bad-name %}", {
      state: "EMIT",
      currentContext: {},
      textBufferParts: [],
      ifStack: [],
      skipDepth: 0,
      skipMode: null,
      capture: null,
      raw: null,
      runtime: { counters: Object.create(null) },
    });
    const invalidRange = engine.resolveArgument("(start..2)", { start: "oops" });

    assert.equal(malformedCounter, "");
    assert.deepEqual(invalidRange, []);
  });
});
