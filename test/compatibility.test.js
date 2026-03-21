import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Liquid as LiquidJS } from "liquidjs";
import { Liquid } from "../src/index.js";

async function renderBoth(template, context = {}) {
  const workerEngine = new Liquid();
  const liquidjsEngine = new LiquidJS();

  const [actual, expected] = await Promise.all([
    workerEngine.parseAndRender(template, context),
    liquidjsEngine.parseAndRender(template, context),
  ]);

  return { actual, expected };
}

describe("Liquid compatibility with liquidjs", () => {
  it("matches whitespace control for variables and blocks", async () => {
    const template = "A {{- val -}} B {%- if true -%} C {%- endif -%} D";
    const { actual, expected } = await renderBoth(template, { val: "x" });

    assert.equal(actual, expected);
  });

  it("matches Liquid truthiness for zero and empty strings", async () => {
    const zero = await renderBoth(
      "{% assign x = 0 %}{% if x %}T{% else %}F{% endif %}",
      {},
    );
    const empty = await renderBoth(
      '{% assign x = "" %}{% if x %}T{% else %}F{% endif %}',
      {},
    );

    assert.equal(zero.actual, zero.expected);
    assert.equal(empty.actual, empty.expected);
  });

  it("matches array access semantics", async () => {
    const bracket = await renderBoth("{{ my_array[0] }}", {
      my_array: ["alpha", "beta"],
    });
    const first = await renderBoth("{{ my_array.first }}", {
      my_array: ["alpha", "beta"],
    });

    assert.equal(bracket.actual, bracket.expected);
    assert.equal(first.actual, first.expected);
  });

  it("matches chained filter output with complex arguments", async () => {
    const template =
      '{{ missing | default: "  A:B,C  " | strip | downcase | split: ":" | last | capitalize }}';
    const { actual, expected } = await renderBoth(template, {});

    assert.equal(actual, expected);
  });

  it("matches basic loop rendering", async () => {
    const template = "{% for i in list %}[{{ i }}]{% endfor %}";
    const { actual, expected } = await renderBoth(template, {
      list: [1, 2, 3],
    });

    assert.equal(actual, expected);
  });

  it("matches complex loop controls", async () => {
    const template = "{% for i in list limit:2 offset:1 reversed %}[{{ i }}]{% endfor %}";
    const { actual, expected } = await renderBoth(template, {
      list: [1, 2, 3, 4],
    });

    assert.equal(actual, expected);
  });

  it("matches nested logic with comparison and boolean operators", async () => {
    const template = `
      {% if a > 1 and b <= 2 or c != 4 %}
        {% if list contains "x" %}T{% else %}F{% endif %}
      {% else %}
        F
      {% endif %}
    `;
    const { actual, expected } = await renderBoth(template, {
      a: 2,
      b: 2,
      c: 4,
      list: ["x", "y"],
    });

    assert.equal(actual.replaceAll(/\s+/g, ""), expected.replaceAll(/\s+/g, ""));
  });
});
